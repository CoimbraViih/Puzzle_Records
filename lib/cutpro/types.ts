export interface CutProTemplate {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

export interface AnalyzeVideoResult {
  /** Estimativa de créditos (1 crédito = 1 min de vídeo-fonte, ver
   * PLANO-INTEGRACAO-CUTPRO.md D4) que o pipeline completo vai consumir. */
  estimatedCredits: number;
  durationSeconds: number;
}

export interface UploadHandle {
  uploadUrl: string;
  videoId: string;
}

export interface ClippingSubmission {
  submissionId: string;
  status: "processing" | "done" | "error";
  error?: string;
}

export interface Clip {
  id: string;
  score?: number;
  durationSeconds?: number;
}

export interface RenderStatus {
  status: "processing" | "done" | "error";
  /** Render servido do cache do Cut.Pro — pula direto ao download, sem
   * consumir créditos de novo (documentado em PLANO-INTEGRACAO-CUTPRO.md D4). */
  fromCache?: boolean;
  /** true → bloquear e gravar erro explícito antes de gastar créditos/tempo
   * baixando um vídeo com marca d'água (plano precisa estar confirmado sem
   * marca d'água, ver D0). */
  hasWatermark?: boolean;
  error?: string;
}

export interface CutProBalance {
  remainingCredits: number;
  planCredits: number;
}

/**
 * Superfície da API real do Cut.Pro auditada por Victor em 13/07/2026
 * (ver PLANO-INTEGRACAO-CUTPRO.md e PLANO-DE-IMPLEMENTACAO.md) — não é a
 * simples "upload + apply_template" que uma leitura superficial do produto
 * sugere: o fluxo é clipagem por IA de um vídeo-fonte (submitClipping →
 * getSubmission → listClips escolhe o clipe) seguida de aplicação de
 * template (applyTemplate) e render assíncrono (renderClip → getRender →
 * getRenderDownloadUrl). `/templates` é somente leitura (criar/editar só no
 * editor visual deles — listTemplates(filter: "mine") é obrigatório porque
 * applyTemplate só aceita template já copiado para a conta própria).
 */
export interface CutProProvider {
  analyzeVideo(videoUrl: string): Promise<AnalyzeVideoResult>;

  startUpload(filename: string, contentType: string): Promise<UploadHandle>;
  completeUpload(videoId: string): Promise<void>;

  submitClipping(videoId: string): Promise<{ submissionId: string }>;
  getSubmission(submissionId: string): Promise<ClippingSubmission>;
  listClips(submissionId: string): Promise<Clip[]>;

  applyTemplate(clipId: string, templateId: string): Promise<{ renderId: string }>;
  renderClip(renderId: string): Promise<void>;
  getRender(renderId: string): Promise<RenderStatus>;
  getRenderDownloadUrl(renderId: string): Promise<string>;

  /** filter "mine" é o único uso real deste projeto — applyTemplate recusa
   * template público não copiado para a conta (TEMPLATE_NOT_FOUND). */
  listTemplates(filter?: "mine" | "public"): Promise<CutProTemplate[]>;
  getBalance(): Promise<CutProBalance>;
}

/** Lançado por qualquer CutProProvider em falha — nunca lança erro genérico. */
export class CutProError extends Error {}

/**
 * Subtipo de CutProError para 429 BATCH_ALREADY_RUNNING (plano permite só 1
 * job de applyTemplate por vez) — "tenta de novo no próximo ciclo do cron
 * cutpro-pipeline", distinto de uma falha real. Quem chama não deve gravar
 * `cutpro_error` nem avançar/reverter `edit_status` para este caso.
 */
export class CutProRateLimitError extends CutProError {}
