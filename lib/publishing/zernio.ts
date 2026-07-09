import type {
  PostMetrics,
  PublishInput,
  PublishingProvider,
  PublishResult,
} from "./types";
import { PublishError } from "./types";

// Base URL confirmada em docs.zernio.com (auditoria do M12) — antes era um
// valor "assumido" sem doc real disponível (débito técnico do M7).
// Overridável por env var só por precaução (staging/sandbox do Zernio).
const ZERNIO_BASE_URL = process.env.ZERNIO_API_BASE_URL ?? "https://zernio.com/api/v1";

interface ZernioErrorBody {
  error?: string;
  type?: string;
  code?: string;
}

function authHeaders(apiKey: string, extra?: Record<string, string>) {
  return { Authorization: `Bearer ${apiKey}`, ...extra };
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

export class ZernioProvider implements PublishingProvider {
  async publish(input: PublishInput): Promise<PublishResult> {
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
    } catch {
      throw new PublishError("Falha de rede ao chamar a API do Zernio (POST /posts).");
    }

    if (!response.ok) {
      throw new PublishError(await zernioErrorMessage(response));
    }

    const data = (await response.json().catch(() => null)) as {
      id?: string;
      platforms?: {
        platform: string;
        status?: string;
        publishedUrl?: string;
        error?: string;
      }[];
    } | null;

    if (!data?.id) {
      throw new PublishError("Resposta do Zernio sem `id` do post (POST /posts).");
    }

    const platformResult = data.platforms?.find(
      (p) => p.platform === input.network
    );
    if (!platformResult) {
      throw new PublishError(
        `Resposta do Zernio sem resultado para a plataforma "${input.network}".`
      );
    }
    if (platformResult.error) {
      throw new PublishError(
        `Zernio falhou ao publicar em ${input.network}: ${platformResult.error}`
      );
    }
    if (!platformResult.publishedUrl) {
      // Documentado: o TikTok expõe o ID do vídeo de forma assíncrona (via
      // webhook post.tiktok.url_resolved), não na resposta síncrona do
      // POST /posts. Sem webhook implementado ainda, tratamos como falha
      // explícita em vez de gravar um post_url vazio — nunca falha em
      // silêncio, mesmo padrão do resto do projeto.
      throw new PublishError(
        `Zernio aceitou a publicação em ${input.network}, mas ainda não retornou o link público na resposta síncrona (comum no TikTok, que resolve o link via webhook assíncrono — sem suporte a webhooks ainda neste projeto).`
      );
    }

    return { postUrl: platformResult.publishedUrl, zernioPostId: data.id };
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
    } catch {
      throw new PublishError("Falha de rede ao baixar a mídia para envio ao Zernio.");
    }
    if (!mediaResponse.ok) {
      throw new PublishError(
        `Falha ao baixar a mídia (${mediaResponse.status}) antes de enviar ao Zernio.`
      );
    }
    const contentType =
      mediaResponse.headers.get("content-type") ??
      (mediaType === "image" ? "image/png" : "video/mp4");
    const mediaBytes = await mediaResponse.arrayBuffer();

    let presignResponse: Response;
    try {
      presignResponse = await fetch(`${ZERNIO_BASE_URL}/media/presign`, {
        method: "POST",
        headers: authHeaders(apiKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({ contentType, type: mediaType }),
      });
    } catch {
      throw new PublishError(
        "Falha de rede ao chamar a API do Zernio (POST /media/presign)."
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
    } catch {
      throw new PublishError(
        "Falha de rede ao subir a mídia para a URL pré-assinada do Zernio."
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
    } catch {
      throw new PublishError("Falha de rede ao chamar a API do Zernio (GET /analytics).");
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
