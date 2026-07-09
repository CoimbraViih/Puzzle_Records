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
  /**
   * `onSubmitted` é chamado assim que o provedor confirma que aceitou o
   * post (antes de saber o resultado final) — quem chama deve persistir
   * esse ID imediatamente. A partir desse ponto a publicação já é
   * irreversível do lado do provedor: se a função cair antes de `publish`
   * resolver, uma nova chamada a `publish` para o mesmo post duplicaria a
   * publicação. Nesse cenário, quem chama deve usar `resolvePendingPublish`
   * com o ID já persistido, nunca `publish` de novo.
   */
  publish(
    input: PublishInput,
    onSubmitted?: (providerId: string) => Promise<void>
  ): Promise<PublishResult>;
  /**
   * Reconsulta o resultado de um post já submetido anteriormente (ID vindo
   * de um `onSubmitted` de uma chamada de `publish` que não chegou a
   * resolver) — nunca submete de novo, só verifica o status atual.
   */
  resolvePendingPublish(
    providerId: string,
    network: string
  ): Promise<PublishResult>;
  /** Lança PublishError em qualquer falha — nunca retorna dado parcial
   * silenciosamente. Recebe o zernioPostId gravado por publish(), não o
   * link público (a API de analytics do Zernio busca por postId). */
  getMetrics(zernioPostId: string): Promise<PostMetrics>;
}

/** Lançado por qualquer PublishingProvider em falha — nunca lança erro genérico. */
export class PublishError extends Error {}

/**
 * Subtipo de PublishError para "ainda não resolvido, tenta de novo depois"
 * (ex: o Zernio ainda está processando a publicação) — distinto de uma
 * falha real. Quem chama deve tratar isso sem contar como falha de conta
 * nem bloquear o post de ser reconsultado no próximo ciclo do cron (não
 * deve gravar em `publish_error`, que exclui o post das próximas buscas).
 */
export class PublishPendingError extends PublishError {}
