export interface PublishInput {
  postId: string;
  zernioAccountId: string;
  /** Rede da conta social (mesmos valores de social_accounts.network) — a
   * API real do Zernio publica em `platforms: [{ platform, accountId }]`. */
  network: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
}

export interface PublishResult {
  postUrl: string;
  /** ID interno do post no Zernio (campo `id` da resposta de POST /v1/posts)
   * — necessário depois para buscar métricas via GET /v1/analytics, que usa
   * esse ID e não o link público da rede social. */
  zernioPostId: string;
}

export interface PostMetrics {
  likes: number | null;
  comments: number | null;
  reach: number | null;
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
  /** Lança PublishError em qualquer falha — nunca retorna dado parcial
   * silenciosamente. Recebe o zernioPostId gravado por publish(), não o
   * link público (a API de analytics do Zernio busca por postId). */
  getMetrics(zernioPostId: string): Promise<PostMetrics>;
}

/** Lançado por qualquer PublishingProvider em falha — nunca lança erro genérico. */
export class PublishError extends Error {}
