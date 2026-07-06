export function newPostSubject(headline: string | null) {
  return `Novo post aguardando aprovação${headline ? `: ${headline}` : ""}`;
}

export function newPostBody(postId: string, headline: string | null) {
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/aprovacao`;
  return `<p>Um post está aguardando sua aprovação${
    headline ? `: <strong>${headline}</strong>` : ""
  }.</p><p><a href="${url}">Abrir a fila de aprovação</a></p>`;
}

export function slaAlertSubject(headline: string | null) {
  return `⏰ SLA de aprovação vencido${headline ? `: ${headline}` : ""}`;
}

export function slaAlertBody(postId: string, headline: string | null) {
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/aprovacao`;
  return `<p>Um post está pendente de aprovação há mais de 4 horas${
    headline ? `: <strong>${headline}</strong>` : ""
  }.</p><p><a href="${url}">Abrir a fila de aprovação</a></p>`;
}
