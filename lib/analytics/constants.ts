/**
 * Número de falhas consecutivas de publicação numa conta social que marca
 * connection_status='desconectada' e dispara o alerta por e-mail. Constante
 * de código (não configurável por admin) por decisão do design — ver
 * docs/superpowers/specs/2026-07-07-m9-analytics-alertas-design.md.
 */
export const DISCONNECT_FAILURE_THRESHOLD = 3;

/** Janela de coleta de métricas: posts publicados há mais tempo que isso param de ser consultados no Zernio. */
export const METRICS_COLLECTION_WINDOW_DAYS = 30;
