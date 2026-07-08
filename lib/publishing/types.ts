export interface PublishInput {
  postId: string;
  zernioAccountId: string;
  mediaUrl: string;
  caption: string;
}

export interface PublishResult {
  postUrl: string;
}

export interface PostMetrics {
  likes: number | null;
  comments: number | null;
  reach: number | null;
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
  /** Lança PublishError em qualquer falha — nunca retorna dado parcial silenciosamente. */
  getMetrics(postUrl: string): Promise<PostMetrics>;
}

/** Lançado por qualquer PublishingProvider em falha — nunca lança erro genérico. */
export class PublishError extends Error {}
