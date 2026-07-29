import * as Sentry from "@sentry/nextjs";

// Instrumentação server-side (App Router, ver instrumentation.ts). Sem
// SENTRY_DSN configurada (ex: dev local sem projeto Sentry vinculado ainda),
// o SDK simplesmente não envia nada — nunca quebra o app.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
