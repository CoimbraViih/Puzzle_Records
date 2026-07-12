export interface AcervoCandidate {
  id: string;
  created_at: string;
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

/** Escolhe o candidato mais antigo do acervo (FIFO puro — sem anti-repetição por artista, removida no pivô de 10/07/2026). */
export function pickCandidateForSlot(
  candidates: AcervoCandidate[]
): AcervoCandidate | null {
  const sorted = [...candidates].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return sorted[0] ?? null;
}
