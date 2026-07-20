/** Renomeado de lib/acervo/scheduler.ts (M21) quando o agendador de
 * horários diários deixou de ser exclusivo de acervo. */
export interface SchedulableCandidate {
  id: string;
  created_at: string;
  content_source: string;
}

/** Um slot de horário (HH:MM) já ocupado nesse dia por outro post da conta. */
export function isSlotTaken(
  slotDateTime: Date,
  occupiedDateTimes: Date[]
): boolean {
  return occupiedDateTimes.some(
    (occupied) => Math.abs(occupied.getTime() - slotDateTime.getTime()) < 60_000
  );
}

/**
 * Escolhe o próximo post pra ocupar um slot: conteúdo curado (Drive/Post
 * rápido) sempre antes de acervo — mesma distinção "volume × estratégico"
 * de docs/CLAUDE.md — e FIFO (mais antigo primeiro) dentro de cada grupo.
 * Sem anti-repetição por artista (removida no pivô de 10/07/2026).
 */
export function pickCandidateForSlot(
  candidates: SchedulableCandidate[]
): SchedulableCandidate | null {
  const byAge = (a: SchedulableCandidate, b: SchedulableCandidate) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

  const curated = candidates
    .filter((c) => c.content_source !== "acervo")
    .sort(byAge);
  if (curated.length > 0) return curated[0];

  const acervo = candidates.filter((c) => c.content_source === "acervo").sort(byAge);
  return acervo[0] ?? null;
}
