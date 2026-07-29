import * as Sentry from "@sentry/nextjs";

/**
 * Instrumentação server-side do Sentry (App Router) — só Node.js runtime,
 * sem client/edge/source maps por enquanto (auditoria de produto de
 * 29/07/2026). Ganho imediato: capturar os erros de servidor que hoje só
 * vão pra console.error ou em silêncio total.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
