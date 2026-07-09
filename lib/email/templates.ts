import { DISCONNECT_FAILURE_THRESHOLD } from "@/lib/analytics/constants";
import type { WeeklySummary } from "@/lib/reports/weeklySummary";

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

export function weeklyReportSubject(weekEndIso: string) {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(weekEndIso));
  return `📊 Relatório semanal Puzzle Records — semana até ${date}`;
}

export function weeklyReportBody(summary: WeeklySummary) {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/dashboard`;
  const top = summary.topPosts
    .map((post) => {
      const label = escapeHtml(post.headline ?? post.caption ?? "Post");
      const artist = post.artistName ? ` (${escapeHtml(post.artistName)})` : "";
      const link = post.postUrl
        ? ` — <a href="${escapeHtml(post.postUrl)}">ver post</a>`
        : "";
      return `<li>${label}${artist}: ${post.likes} curtidas, ${post.comments} comentários${link}</li>`;
    })
    .join("");
  const accounts = summary.byAccount
    .map(
      (a) =>
        `<li>${escapeHtml(a.account)}: ${a.published} posts, ${a.likes} curtidas, ${a.comments} comentários, alcance ${a.reach}</li>`
    )
    .join("");
  const disconnected =
    summary.disconnectedAccounts.length > 0
      ? `<p>⚠️ Contas possivelmente desconectadas: <strong>${summary.disconnectedAccounts
          .map(escapeHtml)
          .join(", ")}</strong></p>`
      : "";
  return (
    `<p>Resumo dos últimos 7 dias:</p>` +
    `<ul><li><strong>${summary.publishedCount}</strong> posts publicados</li>` +
    `<li><strong>${summary.approvedPendingCount}</strong> aprovados aguardando publicação</li>` +
    `<li><strong>${summary.failedCount}</strong> posts com erro de publicação</li></ul>` +
    (top ? `<p><strong>Top posts:</strong></p><ul>${top}</ul>` : "") +
    (accounts ? `<p><strong>Por conta:</strong></p><ul>${accounts}</ul>` : "") +
    disconnected +
    `<p><a href="${url}">Abrir o dashboard</a></p>`
  );
}
