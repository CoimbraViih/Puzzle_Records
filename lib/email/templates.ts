import { DISCONNECT_FAILURE_THRESHOLD } from "@/lib/analytics/constants";

// Manchetes vêm da IA (M4) ou de edição manual — nunca confiar nelas como
// HTML/texto de cabeçalho já seguro para interpolar direto no e-mail.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeSubjectText(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function newPostSubject(headline: string | null) {
  const safeHeadline = headline ? sanitizeSubjectText(headline) : null;
  return `Novo post aguardando aprovação${safeHeadline ? `: ${safeHeadline}` : ""}`;
}

export function newPostBody(postId: string, headline: string | null) {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/aprovacao`;
  const safeHeadline = headline ? escapeHtml(headline) : null;
  return `<p>Um post está aguardando sua aprovação${
    safeHeadline ? `: <strong>${safeHeadline}</strong>` : ""
  }.</p><p><a href="${url}">Abrir a fila de aprovação</a></p>`;
}

export function slaAlertSubject(headline: string | null) {
  const safeHeadline = headline ? sanitizeSubjectText(headline) : null;
  return `⏰ SLA de aprovação vencido${safeHeadline ? `: ${safeHeadline}` : ""}`;
}

export function slaAlertBody(postId: string, headline: string | null) {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/aprovacao`;
  const safeHeadline = headline ? escapeHtml(headline) : null;
  return `<p>Um post está pendente de aprovação há mais de 4 horas${
    safeHeadline ? `: <strong>${safeHeadline}</strong>` : ""
  }.</p><p><a href="${url}">Abrir a fila de aprovação</a></p>`;
}

export function accountDisconnectedSubject(accountLabel: string) {
  return `🔌 Conta social possivelmente desconectada: ${sanitizeSubjectText(accountLabel)}`;
}

export function accountDisconnectedBody(accountLabel: string) {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/contas`;
  const safeLabel = escapeHtml(accountLabel);
  return `<p>A conta <strong>${safeLabel}</strong> falhou ao publicar ${DISCONNECT_FAILURE_THRESHOLD} vezes seguidas — possível desconexão no Zernio.</p><p><a href="${url}">Abrir /admin/contas</a></p>`;
}
