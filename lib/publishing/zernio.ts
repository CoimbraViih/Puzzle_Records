import type {
  PostMetrics,
  PublishInput,
  PublishingProvider,
  PublishResult,
} from "./types";
import { PublishError, PublishPendingError } from "./types";

// Base URL confirmada em docs.zernio.com (auditoria do M12) — antes era um
// valor "assumido" sem doc real disponível (débito técnico do M7).
// Overridável por env var só por precaução (staging/sandbox do Zernio).
const ZERNIO_BASE_URL = process.env.ZERNIO_API_BASE_URL || "https://zernio.com/api/v1";

interface ZernioErrorBody {
  error?: string;
  type?: string;
  code?: string;
}

function authHeaders(apiKey: string, extra?: Record<string, string>) {
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

/** Extrai uma mensagem legível de qualquer valor lançado por fetch (TypeError
 * de rede, DNS, etc.) — nunca descarta o erro real num "falha de rede"
 * genérico, senão fica impossível diagnosticar o que realmente houve. */
function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Envelope de erro documentado em docs.zernio.com: {error, type, code, ...}. */
async function zernioErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ZernioErrorBody | null;
  if (body?.error) {
    return `Zernio (${response.status}${body.code ? `/${body.code}` : ""}): ${body.error}`;
  }
  return `Zernio retornou ${response.status} sem corpo de erro reconhecível.`;
}

function requireApiKey(): string {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    throw new PublishError("ZERNIO_API_KEY não configurada.");
  }
  return apiKey;
}

interface ZernioPlatformState {
  platform: string;
  status?: string;
  platformPostUrl?: string;
  error?: string;
}

interface ZernioPostState {
  _id: string;
  status?: string;
  platforms?: ZernioPlatformState[];
}

// Publicação no Zernio é assíncrona MESMO para Instagram — não só para o
// TikTok como a doc pública (docs.zernio.com) sugere. A resposta síncrona de
// POST /posts vem com platforms[].status "processing" e sem
// platformPostUrl; confirmado testando manualmente contra a API real em
// 09/07/2026 (ver PLAN.md M12) — o post só aparece como "published", com
// platformPostUrl preenchido, minutos depois, consultável via
// GET /posts/{id}. Sem suporte a webhooks ainda, então este adapter faz
// polling limitado dentro da própria chamada de publish().
const PUBLISH_POLL_INTERVAL_MS = 3000;
const PUBLISH_POLL_MAX_ATTEMPTS = 10; // ~30s de espera total

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ZernioProvider implements PublishingProvider {
  async publish(
    input: PublishInput,
    onSubmitted?: (providerId: string) => Promise<void>
  ): Promise<PublishResult> {
    const apiKey = requireApiKey();

    const mediaPublicUrl = await this.uploadMedia(
      apiKey,
      input.mediaUrl,
      input.mediaType
    );

    let response: Response;
    try {
      response = await fetch(`${ZERNIO_BASE_URL}/posts`, {
        method: "POST",
        headers: authHeaders(apiKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          content: input.caption,
          publishNow: true,
          platforms: [
            { platform: input.network, accountId: input.zernioAccountId },
          ],
          mediaItems: [{ url: mediaPublicUrl, type: input.mediaType }],
        }),
      });
    } catch (err) {
      throw new PublishError(
        `Falha de rede ao chamar a API do Zernio (POST /posts): ${describeThrown(err)}`
      );
    }

    if (!response.ok) {
      throw new PublishError(await zernioErrorMessage(response));
    }

    // Formato real da resposta (diferente do documentado publicamente):
    // {post: {_id, status, platforms: [...]}, message}, não {id, platforms}.
    const created = (await response.json().catch(() => null)) as {
      post?: ZernioPostState;
    } | null;

    const zernioPostId = created?.post?._id;
    if (!zernioPostId) {
      throw new PublishError("Resposta do Zernio sem `post._id` (POST /posts).");
    }

    // A partir daqui o post já foi submetido ao Zernio de forma
    // irreversível — persiste o ID imediatamente (antes de saber o
    // resultado final) para que uma interrupção no polling abaixo não
    // resulte em reenvio duplicado numa tentativa futura (ver
    // resolvePendingPublish, chamado pelo cron quando o post já tem um ID
    // gravado).
    if (onSubmitted) {
      await onSubmitted(zernioPostId);
    }

    return this.resolvePendingPublish(zernioPostId, input.network);
  }

  /** Reconsulta (sem resubmeter) um post já aceito pelo Zernio numa chamada
   * anterior de publish() que não chegou a resolver. */
  async resolvePendingPublish(
    zernioPostId: string,
    network: string
  ): Promise<PublishResult> {
    const apiKey = requireApiKey();
    const resolved = await this.pollUntilResolved(apiKey, zernioPostId, network);

    if (resolved.error) {
      throw new PublishError(
        `Zernio falhou ao publicar em ${network} (id do post: ${zernioPostId}): ${resolved.error}`
      );
    }
    if (!resolved.platformPostUrl) {
      // PublishPendingError (não PublishError genérico): ainda não é uma
      // falha, só não resolveu dentro da janela de polling desta chamada —
      // quem chama deve reconsultar no próximo ciclo, sem contar como falha
      // de conta nem bloquear o post de ser reconsultado (ver route.ts).
      throw new PublishPendingError(
        `Zernio não resolveu a publicação em ${network} a tempo (id do post: ${zernioPostId}, ${(PUBLISH_POLL_MAX_ATTEMPTS * PUBLISH_POLL_INTERVAL_MS) / 1000}s de espera) — será reconsultado no próximo ciclo do cron, sem reenviar.`
      );
    }

    return { postUrl: resolved.platformPostUrl, zernioPostId };
  }

  private async pollUntilResolved(
    apiKey: string,
    zernioPostId: string,
    network: string
  ): Promise<{ platformPostUrl?: string; error?: string }> {
    for (let attempt = 0; attempt < PUBLISH_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(PUBLISH_POLL_INTERVAL_MS);

      let response: Response;
      try {
        response = await fetch(`${ZERNIO_BASE_URL}/posts/${zernioPostId}`, {
          headers: authHeaders(apiKey),
        });
      } catch {
        continue; // falha de rede pontual durante o polling — tenta de novo
      }
      if (!response.ok) continue;

      const data = (await response.json().catch(() => null)) as {
        post?: ZernioPostState;
      } | null;

      const platformState = data?.post?.platforms?.find(
        (p) => p.platform === network
      );
      if (!platformState) continue;

      if (platformState.status === "published" && platformState.platformPostUrl) {
        return { platformPostUrl: platformState.platformPostUrl };
      }
      if (platformState.status === "failed" || platformState.error) {
        return { error: platformState.error ?? "status failed sem detalhe." };
      }
      // "processing"/"publishing" — continua tentando.
    }

    return {}; // esgotou o tempo sem resolver
  }

  /**
   * Fluxo de mídia documentado em docs.zernio.com/guides/media-uploads:
   * presign -> upload direto -> publicUrl. O Zernio não documenta aceitar
   * uma URL externa (ex: URL assinada do Supabase Storage) diretamente em
   * `mediaItems`, então baixamos os bytes da nossa mídia já renderizada e
   * reenviamos pelo fluxo oficial deles.
   */
  private async uploadMedia(
    apiKey: string,
    sourceUrl: string,
    mediaType: "image" | "video"
  ): Promise<string> {
    let mediaResponse: Response;
    try {
      mediaResponse = await fetch(sourceUrl);
    } catch (err) {
      throw new PublishError(
        `Falha de rede ao baixar a mídia para envio ao Zernio: ${describeThrown(err)}`
      );
    }
    if (!mediaResponse.ok) {
      throw new PublishError(
        `Falha ao baixar a mídia (${mediaResponse.status}) antes de enviar ao Zernio.`
      );
    }
    const extension = mediaType === "image" ? "png" : "mp4";
    const contentType =
      mediaResponse.headers.get("content-type") ??
      (mediaType === "image" ? "image/png" : "video/mp4");
    const mediaBytes = await mediaResponse.arrayBuffer();

    let presignResponse: Response;
    try {
      presignResponse = await fetch(`${ZERNIO_BASE_URL}/media/presign`, {
        method: "POST",
        headers: authHeaders(apiKey, { "Content-Type": "application/json" }),
        // O campo obrigatório é `filename` (não `type`) — confirmado testando
        // diretamente contra a API real em 09/07/2026; a doc pública não
        // deixava isso claro.
        body: JSON.stringify({
          filename: `puzzle-records.${extension}`,
          contentType,
        }),
      });
    } catch (err) {
      throw new PublishError(
        `Falha de rede ao chamar a API do Zernio (POST /media/presign): ${describeThrown(err)}`
      );
    }
    if (!presignResponse.ok) {
      throw new PublishError(await zernioErrorMessage(presignResponse));
    }

    const presign = (await presignResponse.json().catch(() => null)) as {
      uploadUrl?: string;
      publicUrl?: string;
    } | null;
    if (!presign?.uploadUrl || !presign?.publicUrl) {
      throw new PublishError(
        "Resposta do Zernio sem uploadUrl/publicUrl em /media/presign."
      );
    }

    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: mediaBytes,
      });
    } catch (err) {
      throw new PublishError(
        `Falha de rede ao subir a mídia para a URL pré-assinada do Zernio: ${describeThrown(err)}`
      );
    }
    if (!uploadResponse.ok) {
      throw new PublishError(
        `Zernio recusou o upload da mídia (${uploadResponse.status}).`
      );
    }

    return presign.publicUrl;
  }

  /** GET /v1/analytics?postId=... (documentado em docs.zernio.com/analytics/get-analytics). */
  async getMetrics(zernioPostId: string): Promise<PostMetrics> {
    const apiKey = requireApiKey();

    let response: Response;
    try {
      response = await fetch(
        `${ZERNIO_BASE_URL}/analytics?postId=${encodeURIComponent(zernioPostId)}`,
        { headers: authHeaders(apiKey) }
      );
    } catch (err) {
      throw new PublishError(
        `Falha de rede ao chamar a API do Zernio (GET /analytics): ${describeThrown(err)}`
      );
    }

    if (response.status === 202) {
      // Documentado: sincronização de métricas ainda pendente no Zernio —
      // não é erro, só "ainda não há dado". Trata como falha desta coleta
      // (mesmo padrão de metrics_error), o próximo ciclo do cron tenta de novo.
      throw new PublishError(
        "Zernio ainda está sincronizando as métricas deste post (202) — tenta de novo no próximo ciclo."
      );
    }
    if (response.status === 402) {
      throw new PublishError(
        "Zernio exige add-on de analytics pago para esta conta (402)."
      );
    }
    if (!response.ok) {
      throw new PublishError(await zernioErrorMessage(response));
    }

    const data = (await response.json().catch(() => null)) as {
      analytics?: {
        likes?: number;
        comments?: number;
        reach?: number;
      };
    } | null;

    const analytics = data?.analytics;
    if (!analytics) {
      throw new PublishError("Resposta do Zernio sem o campo `analytics`.");
    }

    if (
      analytics.likes == null &&
      analytics.comments == null &&
      analytics.reach == null
    ) {
      throw new PublishError(
        "Resposta do Zernio sem nenhuma métrica preenchida (likes/comments/reach todos ausentes)."
      );
    }

    return {
      likes: analytics.likes ?? null,
      comments: analytics.comments ?? null,
      reach: analytics.reach ?? null,
    };
  }
}
