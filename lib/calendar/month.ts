import type { PostWithRelations } from "@/lib/types/post";

export interface CalendarDay {
  /** "YYYY-MM-DD" — chave estável do dia, sem hora/fuso. */
  iso: string;
  day: number;
  inMonth: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Grade mensal domingo→sábado. Datas manipuladas como UTC puro (Date.UTC)
 * de propósito: aqui só interessa aritmética de dias-do-calendário, sem
 * hora — o fuso só entra ao converter timestamps de posts (dayKeyInSaoPaulo).
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay()); // volta ao domingo da 1ª semana

  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        iso: `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`,
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

/** Dia-calendário de um timestamp no fuso America/Sao_Paulo ("YYYY-MM-DD"). */
export function dayKeyInSaoPaulo(isoTimestamp: string): string {
  // en-CA formata como YYYY-MM-DD, dispensando remontagem manual de parts.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTimestamp));
}

export function groupPostsByDay(
  posts: PostWithRelations[]
): Map<string, PostWithRelations[]> {
  const byDay = new Map<string, PostWithRelations[]>();
  for (const post of posts) {
    const timestamp = post.scheduled_at ?? post.published_at;
    if (!timestamp) continue;
    const key = dayKeyInSaoPaulo(timestamp);
    const list = byDay.get(key) ?? [];
    list.push(post);
    byDay.set(key, list);
  }
  // Ordena os posts de cada dia por horário.
  for (const list of byDay.values()) {
    list.sort((a, b) =>
      (a.scheduled_at ?? a.published_at ?? "").localeCompare(
        b.scheduled_at ?? b.published_at ?? ""
      )
    );
  }
  return byDay;
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
