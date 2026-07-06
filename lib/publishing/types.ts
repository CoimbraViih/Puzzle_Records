export interface PublishInput {
  postId: string;
  zernioAccountId: string;
  mediaUrl: string;
  caption: string;
}

export interface PublishResult {
  postUrl: string;
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Lançado por qualquer PublishingProvider em falha — nunca lança erro genérico. */
export class PublishError extends Error {}
