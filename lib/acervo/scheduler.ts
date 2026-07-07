import { ACERVO_ARTIST_MIN_GAP_DAYS } from "./constants";

export interface AcervoCandidate {
  id: string;
  artist_id: string | null;
  created_at: string;
}

export interface RecentArtistPost {
  artist_id: string | null;
  scheduled_or_published_at: string;
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
 * Escolhe o próximo candidato elegível para um slot: o mais antigo no
 * acervo (FIFO) cujo artista não tenha post agendado/publicado dentro da
 * janela mínima de repetição, relativa ao horário do slot.
 */
export function pickCandidateForSlot(
  slotDateTime: Date,
  candidates: AcervoCandidate[],
  recentArtistPosts: RecentArtistPost[]
): AcervoCandidate | null {
  const gapMs = ACERVO_ARTIST_MIN_GAP_DAYS * 24 * 60 * 60 * 1000;

  const blockedArtistIds = new Set(
    recentArtistPosts
      .filter((entry) => {
        if (!entry.artist_id) return false;
        const diff = Math.abs(
          slotDateTime.getTime() -
            new Date(entry.scheduled_or_published_at).getTime()
        );
        return diff < gapMs;
      })
      .map((entry) => entry.artist_id)
  );

  const sorted = [...candidates].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    sorted.find(
      (candidate) =>
        !candidate.artist_id || !blockedArtistIds.has(candidate.artist_id)
    ) ?? null
  );
}
