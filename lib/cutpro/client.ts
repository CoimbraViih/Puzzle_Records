import type {
  Clip,
  ClippingSubmission,
  CompletedUpload,
  CutProBalance,
  CutProProvider,
  CutProTemplate,
  RenderStatus,
  RenderSubmission,
  UploadHandle,
} from "./types";
import { CutProError, CutProRateLimitError } from "./types";

// Base e endpoints validados contra a doc oficial (cut.pro/docs) em
// 15/07/2026 com a chave real da conta — ver
// docs/plans/2026-07-15-m16-drive-cutpro.md para o detalhe endpoint a
// endpoint. Substitui o palpite de D1 (api.cutpro.io, domínio que nem
// resolve).
const CUTPRO_BASE_URL = process.env.CUTPRO_API_BASE_URL || "https://api.cut.pro/api/v1";

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// CUTPRO_WORKSPACE_ID é opcional — só necessária em chaves multi-workspace;
// quando ausente, os endpoints operam sobre o workspace padrão da chave.
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
  requiredFields: (keyof T)[],
  okStatuses: number[] = [200]
): Promise<{ status: number; data: T }> {
  const apiKey = requireApiKey();
  let response: Response;
  try {
    response = await fetch(`${CUTPRO_BASE_URL}${path}`, {
      ...init,
      headers: authHeaders(apiKey, init.headers as Record<string, string>),
    });
  } catch (err) {
    throw new CutProError(`Falha de rede ao chamar ${path} no Cut.Pro: ${describeThrown(err)}`);
  }

  // Plano com limite de 1 batch job simultâneo de apply_template —
  // documentado como 429 BATCH_ALREADY_RUNNING. Tratado como "tenta de novo
  // no próximo ciclo do cron", não como erro real.
  if (response.status === 429) {
    throw new CutProRateLimitError(
      `Cut.Pro recusou ${path} por limite de concorrência do plano (429) — retry no próximo ciclo.`
    );
  }
  if (!okStatuses.includes(response.status)) {
    throw new CutProError(await cutproErrorMessage(response));
  }

  const data = (await response.json().catch(() => null)) as T | null;
  if (!data || requiredFields.some((field) => data[field] == null)) {
    throw new CutProError(
      `Resposta do Cut.Pro em ${path} sem os campos esperados (${requiredFields.join(", ")}).`
    );
  }
  return { status: response.status, data };
}

export class CutProClient implements CutProProvider {
  async startUpload(fileName: string, fileSizeBytes: number, contentType?: string): Promise<UploadHandle> {
    const { data } = await requestJson<{ video_id: string; upload_url: string; expires_in: number }>(
      "/videos/upload",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: fileName,
          file_size: fileSizeBytes,
          content_type: contentType ?? "video/mp4",
        }),
      },
      ["video_id", "upload_url", "expires_in"]
    );
    return { videoId: data.video_id, uploadUrl: data.upload_url, expiresIn: data.expires_in };
  }

  async completeUpload(
    videoId: string,
    fileName: string,
    durationSeconds: number,
    width: number,
    height: number
  ): Promise<CompletedUpload> {
    const { data } = await requestJson<{
      video_id: string;
      title: string;
      duration: number;
      thumbnail_url?: string | null;
      credits_cost: number;
      credits_original: number;
      discount_percent: number;
      force_watermark: boolean;
      current_balance: number;
    }>(
      "/videos/upload/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: videoId,
          file_name: fileName,
          duration: durationSeconds,
          width,
          height,
        }),
      },
      ["video_id", "duration", "credits_cost", "force_watermark", "current_balance"]
    );
    return {
      videoId: data.video_id,
      title: data.title,
      durationSeconds: data.duration,
      thumbnailUrl: data.thumbnail_url,
      creditsCost: data.credits_cost,
      creditsOriginal: data.credits_original,
      discountPercent: data.discount_percent,
      forceWatermark: data.force_watermark,
      currentBalance: data.current_balance,
    };
  }

  async submitClipping(
    videoId: string,
    options?: { templateId?: string; sourceLanguage?: "auto" | "en" | "pt" }
  ): Promise<{ submissionId: string; creditsCharged: number }> {
    const { data } = await requestJson<{
      submission_id: string;
      video_id: string;
      status: string;
      credits_charged: number;
    }>(
      "/clips",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: videoId,
          source_language: options?.sourceLanguage ?? "auto",
          template_id: options?.templateId ?? null,
        }),
      },
      ["submission_id", "credits_charged"],
      [201]
    );
    return { submissionId: data.submission_id, creditsCharged: data.credits_charged };
  }

  async getSubmission(videoId: string, submissionId: string): Promise<ClippingSubmission> {
    const { data } = await requestJson<{
      submission_id: string;
      video_id: string;
      status: ClippingSubmission["status"];
      error_code?: string | null;
      clips_count: number;
    }>(`/clips/${videoId}/submissions/${submissionId}`, { method: "GET" }, ["submission_id", "status"]);
    return {
      submissionId: data.submission_id,
      videoId: data.video_id,
      status: data.status,
      errorCode: data.error_code,
      clipsCount: data.clips_count,
    };
  }

  async listClips(videoId: string, submissionId: string): Promise<Clip[]> {
    const { data } = await requestJson<{
      clips: {
        id: string;
        title: string;
        rating: number;
        start_time: number;
        end_time: number;
        download_url: string;
        play_url: string;
        thumbnail_url: string;
        has_template_applied: boolean;
      }[];
    }>(
      `/clips/${videoId}/submissions/${submissionId}/clips?sort=rating&order=desc`,
      { method: "GET" },
      ["clips"]
    );
    return data.clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      rating: clip.rating,
      startTime: clip.start_time,
      endTime: clip.end_time,
      downloadUrl: clip.download_url,
      playUrl: clip.play_url,
      thumbnailUrl: clip.thumbnail_url,
      hasTemplateApplied: clip.has_template_applied,
    }));
  }

  async applyTemplate(
    videoId: string,
    submissionId: string,
    templateId: string,
    clipIds?: string[]
  ): Promise<{ total: number }> {
    const { data } = await requestJson<{ total: number }>(
      `/clips/${videoId}/submissions/${submissionId}/apply_template`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // TEMPLATE_NOT_FOUND (404) é o erro documentado quando o template
        // ainda não foi copiado pra conta própria (ver listTemplates("mine")).
        body: JSON.stringify({ template_id: templateId, ...(clipIds ? { clip_ids: clipIds } : {}) }),
      },
      ["total"],
      [200, 202]
    );
    return { total: data.total };
  }

  async renderClip(videoId: string, submissionId: string, clipId: string): Promise<RenderSubmission> {
    const { status, data } = await requestJson<{
      render_id: string;
      status: "completed" | "queued";
      has_watermark: boolean;
      output_resolution?: string | null;
      from_cache: boolean;
      download_url: string | null;
    }>(
      `/clips/${videoId}/submissions/${submissionId}/clips/${clipId}/render`,
      { method: "POST" },
      ["render_id", "status", "has_watermark", "from_cache"],
      [200, 202]
    );
    void status;
    return {
      renderId: data.render_id,
      status: data.status,
      fromCache: data.from_cache,
      hasWatermark: data.has_watermark,
      outputResolution: data.output_resolution,
      downloadUrl: data.download_url,
    };
  }

  async getRenderStatus(renderId: string): Promise<RenderStatus> {
    const { data } = await requestJson<{
      render_id: string;
      status: RenderStatus["status"];
      progress: number;
    }>(`/renders/${renderId}`, { method: "GET" }, ["render_id", "status"]);
    return { renderId: data.render_id, status: data.status, progress: data.progress ?? 0 };
  }

  async getRenderDownloadUrl(renderId: string): Promise<{ url: string; filename: string }> {
    // Documentada como expirando em 1h — quem chama deve baixar e persistir
    // no Storage imediatamente, nunca guardar esta URL para uso posterior.
    const { data } = await requestJson<{ url: string; filename: string }>(
      `/renders/${renderId}/download`,
      { method: "GET" },
      ["url", "filename"]
    );
    return { url: data.url, filename: data.filename };
  }

  async listTemplates(filter: "mine" | "public" = "mine"): Promise<CutProTemplate[]> {
    const { data } = await requestJson<{
      templates: {
        id: string;
        name: string;
        description?: string | null;
        category?: string | null;
        aspect_ratio?: string | null;
        auto_add_captions: boolean;
        is_public: boolean;
        thumbnail_url?: string | null;
      }[];
    }>(`/templates?filter=${filter}`, { method: "GET" }, ["templates"]);
    return data.templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      aspectRatio: template.aspect_ratio,
      autoAddCaptions: template.auto_add_captions,
      isPublic: template.is_public,
      thumbnailUrl: template.thumbnail_url,
    }));
  }

  async getBalance(): Promise<CutProBalance> {
    const { data } = await requestJson<{ balance: number }>("/balance", { method: "GET" }, ["balance"]);
    return { balance: data.balance };
  }
}
