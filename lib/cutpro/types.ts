export interface CutProTemplate {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  aspectRatio?: string | null;
  autoAddCaptions: boolean;
  isPublic: boolean;
  thumbnailUrl?: string | null;
}

export interface UploadHandle {
  videoId: string;
  uploadUrl: string;
  expiresIn: number;
}

/** Retorno de completeUpload — já inclui o pre-flight de créditos/marca
 * d'água (a API não expõe um endpoint de "analyze" separado para vídeo
 * próprio recém-enviado; `/clips/info` é só para URL pública de terceiros,
 * ex.: YouTube/Twitch — não se aplica ao fluxo de upload próprio do M16). */
export interface CompletedUpload {
  videoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl?: string | null;
  creditsCost: number;
  creditsOriginal: number;
  discountPercent: number;
  /** true → render vai sair com marca d'água (plano não confirmado sem
   * marca d'água, ver D0) — bloquear e gravar erro explícito antes de gastar
   * crédito. */
  forceWatermark: boolean;
  currentBalance: number;
}

export type SubmissionStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "video_analysis"
  | "analyzing"
  | "finalizing"
  | "completed"
  | "failed";

export interface ClippingSubmission {
  submissionId: string;
  videoId: string;
  status: SubmissionStatus;
  errorCode?: string | null;
  clipsCount: number;
}

export interface Clip {
  id: string;
  title: string;
  rating: number;
  startTime: number;
  endTime: number;
  downloadUrl: string;
  playUrl: string;
  thumbnailUrl: string;
  hasTemplateApplied: boolean;
}

export type RenderJobStatus = "queued" | "active" | "completed" | "failed" | "cancelled" | "expired";

/** Retorno de renderClip — 200 (servido do cache, download_url já pronto,
 * sem novo custo) ou 202 (enfileirado, precisa de polling via
 * getRenderStatus). */
export interface RenderSubmission {
  renderId: string;
  status: "completed" | "queued";
  fromCache: boolean;
  hasWatermark: boolean;
  outputResolution?: string | null;
  /** Só preenchido quando fromCache/status "completed" (200). Expira em 1h —
   * usar getRenderDownloadUrl para pegar uma URL fresca se for baixar depois. */
  downloadUrl?: string | null;
}

export interface RenderStatus {
  renderId: string;
  status: RenderJobStatus;
  /** null quando a API não informa progresso nessa consulta — nunca vira 0
   * por default (0% real e "sem info" são estados visualmente diferentes
   * pro quadro de renderização, ver render-status-badge.tsx). */
  progress: number | null;
}

export interface CutProBalance {
  balance: number;
}

/**
 * Superfície real da API do Cut.Pro (base `https://api.cut.pro/api/v1`,
 * validada contra a doc oficial em cut.pro/docs em 15/07/2026 — ver
 * docs/plans/2026-07-15-m16-drive-cutpro.md). Fluxo: upload de vídeo próprio
 * (startUpload → PUT bytes na uploadUrl → completeUpload, que já retorna o
 * pre-flight de créditos/marca d'água) → clipagem por IA (submitClipping,
 * aceita template_id direto — clipes já saem com template aplicado, sem
 * precisar de applyTemplate separado quando o template é conhecido de
 * antemão) → getSubmission em polling até "completed" → listClips escolhe o
 * clipe (maior rating) → renderClip (pode devolver o resultado já pronto se
 * estiver em cache) → getRenderStatus em polling → getRenderDownloadUrl
 * (expira em 1h, baixar imediato). `/templates` é somente leitura — criar ou
 * editar template só no editor visual deles.
 */
export interface CutProProvider {
  startUpload(fileName: string, fileSizeBytes: number, contentType?: string): Promise<UploadHandle>;
  completeUpload(
    videoId: string,
    fileName: string,
    durationSeconds: number,
    width: number,
    height: number
  ): Promise<CompletedUpload>;

  submitClipping(
    videoId: string,
    options?: { templateId?: string; sourceLanguage?: "auto" | "en" | "pt" }
  ): Promise<{ submissionId: string; creditsCharged: number }>;
  getSubmission(videoId: string, submissionId: string): Promise<ClippingSubmission>;
  listClips(videoId: string, submissionId: string): Promise<Clip[]>;

  /** Só necessário se o template não foi passado em submitClipping (ex.:
   * usuário escolheu o template depois de ver os clipes gerados). */
  applyTemplate(
    videoId: string,
    submissionId: string,
    templateId: string,
    clipIds?: string[]
  ): Promise<{ total: number }>;

  renderClip(videoId: string, submissionId: string, clipId: string): Promise<RenderSubmission>;
  getRenderStatus(renderId: string): Promise<RenderStatus>;
  /** URL assinada expira em 1h — baixar e persistir no Storage imediatamente. */
  getRenderDownloadUrl(renderId: string): Promise<{ url: string; filename: string }>;

  /** filter "mine" é o único uso real deste projeto — applyTemplate/
   * submitClipping recusam template público não copiado para a conta
   * (TEMPLATE_NOT_FOUND). */
  listTemplates(filter?: "mine" | "public"): Promise<CutProTemplate[]>;
  getBalance(): Promise<CutProBalance>;
}

/** Lançado por qualquer CutProProvider em falha — nunca lança erro genérico. */
export class CutProError extends Error {}

/**
 * Subtipo de CutProError para 429 BATCH_ALREADY_RUNNING (plano permite só 1
 * batch job de apply_template por vez) — "tenta de novo no próximo ciclo do
 * cron cutpro-pipeline", distinto de uma falha real. Quem chama não deve
 * gravar `cutpro_error` nem avançar/reverter `edit_status` para este caso.
 */
export class CutProRateLimitError extends CutProError {}
