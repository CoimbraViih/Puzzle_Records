import type {
  AnalyzeVideoResult,
  Clip,
  ClippingSubmission,
  CutProBalance,
  CutProProvider,
  CutProTemplate,
  RenderStatus,
  UploadHandle,
} from "./types";
import { CutProError, CutProRateLimitError } from "./types";

// Auditoria real da API feita por Victor em 13/07/2026 (ver
// PLANO-INTEGRACAO-CUTPRO.md e PLANO-DE-IMPLEMENTACAO.md, fonte de verdade
// do escopo/nomes de função) confirmou o fluxo (clipagem por IA + template
// só leitura + 1 job por vez + download_url expira em 1h) mas não expõe o
// schema JSON exato de request/response de cada endpoint — mesmo estágio em
// que o Zernio estava antes do M12 (stub best-effort, isolado atrás de
// CutProProvider para que validar contra chamadas reais, quando D0 estiver
// pronto, seja uma troca de implementação, não um redesenho).
const CUTPRO_BASE_URL = process.env.CUTPRO_API_BASE_URL || "https://api.cutpro.io/v1";

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// CUTPRO_WORKSPACE_ID é opcional (ver PLANO-INTEGRACAO-CUTPRO.md D0 — só
// alguns planos são multi-workspace); quando ausente, os endpoints operam
// sobre o workspace padrão da chave.
function requireApiKey(): string {
  const apiKey = process.env.CUTPRO_API_KEY;
  if (!apiKey) {
    throw new CutProError("CUTPRO_API_KEY não configurada.");
  }
  return apiKey;
}

function authHeaders(apiKey: string, extra?: Record<string, string>) {
  const workspaceId = process.env.CUTPRO_WORKSPACE_ID;
  return {
    "X-Api-Key": apiKey,
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    ...extra,
  };
}

async function cutproErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
    code?: string;
  } | null;
  const message = body?.error ?? body?.message;
  return message
    ? `Cut.Pro (${response.status}${body?.code ? `/${body.code}` : ""}): ${message}`
    : `Cut.Pro retornou ${response.status} sem corpo de erro reconhecível.`;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  requiredFields: (keyof T)[]
): Promise<T> {
  const apiKey = requireApiKey();
  let response: Response;
  try {
    response = await fetch(`${CUTPRO_BASE_URL}${path}`, {
      ...init,
      headers: authHeaders(apiKey, init.headers as Record<string, string>),
    });
  } catch (err) {
    throw new CutProError(
      `Falha de rede ao chamar ${path} no Cut.Pro: ${describeThrown(err)}`
    );
  }

  // Plano com limite de jobs simultâneos de applyTemplate (documentado como
  // 429 BATCH_ALREADY_RUNNING) — tratado como "tenta de novo no próximo
  // ciclo do cron", não como erro real.
  if (response.status === 429) {
    throw new CutProRateLimitError(
      `Cut.Pro recusou ${path} por limite de concorrência do plano (429) — retry no próximo ciclo.`
    );
  }
  if (!response.ok) {
    throw new CutProError(await cutproErrorMessage(response));
  }

  const data = (await response.json().catch(() => null)) as T | null;
  if (!data || requiredFields.some((field) => data[field] == null)) {
    throw new CutProError(
      `Resposta do Cut.Pro em ${path} sem os campos esperados (${requiredFields.join(", ")}).`
    );
  }
  return data;
}

export class CutProClient implements CutProProvider {
  async analyzeVideo(videoUrl: string): Promise<AnalyzeVideoResult> {
    const data = await requestJson<{
      estimated_credits: number;
      duration_seconds: number;
    }>(
      "/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_url: videoUrl }),
      },
      ["estimated_credits", "duration_seconds"]
    );
    return {
      estimatedCredits: data.estimated_credits,
      durationSeconds: data.duration_seconds,
    };
  }

  async startUpload(filename: string, contentType: string): Promise<UploadHandle> {
    const data = await requestJson<{ upload_url: string; video_id: string }>(
      "/uploads",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content_type: contentType }),
      },
      ["upload_url", "video_id"]
    );
    return { uploadUrl: data.upload_url, videoId: data.video_id };
  }

  async completeUpload(videoId: string): Promise<void> {
    const apiKey = requireApiKey();
    let response: Response;
    try {
      response = await fetch(`${CUTPRO_BASE_URL}/uploads/${videoId}/complete`, {
        method: "POST",
        headers: authHeaders(apiKey),
      });
    } catch (err) {
      throw new CutProError(
        `Falha de rede ao concluir upload ${videoId} no Cut.Pro: ${describeThrown(err)}`
      );
    }
    if (!response.ok) {
      throw new CutProError(await cutproErrorMessage(response));
    }
  }

  async submitClipping(videoId: string): Promise<{ submissionId: string }> {
    const data = await requestJson<{ submission_id: string }>(
      "/clipping-submissions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id: videoId }),
      },
      ["submission_id"]
    );
    return { submissionId: data.submission_id };
  }

  async getSubmission(submissionId: string): Promise<ClippingSubmission> {
    const data = await requestJson<{ status: "processing" | "done" | "error"; error?: string }>(
      `/clipping-submissions/${submissionId}`,
      { method: "GET" },
      ["status"]
    );
    return { submissionId, status: data.status, error: data.error };
  }

  async listClips(submissionId: string): Promise<Clip[]> {
    const data = await requestJson<{
      clips: { id: string; score?: number; duration_seconds?: number }[];
    }>(`/clipping-submissions/${submissionId}/clips`, { method: "GET" }, ["clips"]);
    return data.clips.map((clip) => ({
      id: clip.id,
      score: clip.score,
      durationSeconds: clip.duration_seconds,
    }));
  }

  async applyTemplate(clipId: string, templateId: string): Promise<{ renderId: string }> {
    const data = await requestJson<{ render_id: string }>(
      `/clips/${clipId}/apply-template`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // TEMPLATE_NOT_FOUND é o erro documentado quando o template ainda
        // não foi copiado pra conta própria (ver listTemplates("mine")).
        body: JSON.stringify({ template_id: templateId }),
      },
      ["render_id"]
    );
    return { renderId: data.render_id };
  }

  async renderClip(renderId: string): Promise<void> {
    const apiKey = requireApiKey();
    let response: Response;
    try {
      response = await fetch(`${CUTPRO_BASE_URL}/renders/${renderId}/start`, {
        method: "POST",
        headers: authHeaders(apiKey),
      });
    } catch (err) {
      throw new CutProError(
        `Falha de rede ao iniciar render ${renderId} no Cut.Pro: ${describeThrown(err)}`
      );
    }
    if (response.status === 429) {
      throw new CutProRateLimitError(
        `Cut.Pro recusou o render ${renderId} por limite de concorrência do plano (429) — retry no próximo ciclo.`
      );
    }
    if (!response.ok) {
      throw new CutProError(await cutproErrorMessage(response));
    }
  }

  async getRender(renderId: string): Promise<RenderStatus> {
    const data = await requestJson<{
      status: "processing" | "done" | "error";
      from_cache?: boolean;
      has_watermark?: boolean;
      error?: string;
    }>(`/renders/${renderId}`, { method: "GET" }, ["status"]);
    return {
      status: data.status,
      fromCache: data.from_cache,
      hasWatermark: data.has_watermark,
      error: data.error,
    };
  }

  async getRenderDownloadUrl(renderId: string): Promise<string> {
    // Documentado como expirando em 1h (PLANO-INTEGRACAO-CUTPRO.md D4) —
    // quem chama deve baixar e persistir no Storage imediatamente, nunca
    // guardar esta URL para uso posterior.
    const data = await requestJson<{ download_url: string }>(
      `/renders/${renderId}/download-url`,
      { method: "GET" },
      ["download_url"]
    );
    return data.download_url;
  }

  async listTemplates(filter: "mine" | "public" = "mine"): Promise<CutProTemplate[]> {
    const data = await requestJson<{
      templates: { id: string; name: string; thumbnail_url?: string }[];
    }>(`/templates?filter=${filter}`, { method: "GET" }, ["templates"]);
    return data.templates.map((template) => ({
      id: template.id,
      name: template.name,
      thumbnailUrl: template.thumbnail_url,
    }));
  }

  async getBalance(): Promise<CutProBalance> {
    const data = await requestJson<{ remaining_credits: number; plan_credits: number }>(
      "/balance",
      { method: "GET" },
      ["remaining_credits", "plan_credits"]
    );
    return { remainingCredits: data.remaining_credits, planCredits: data.plan_credits };
  }
}
