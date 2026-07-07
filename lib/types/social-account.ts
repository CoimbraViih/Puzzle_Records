export const SOCIAL_NETWORKS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
};

export interface SocialAccount {
  id: string;
  network: SocialNetwork;
  handle: string;
  display_name: string;
  /** Preenchido pelo M7: referência da conta no Zernio (necessária para publicar). */
  zernio_account_id: string | null;
  /** Preenchido pelo M8: horários-alvo (HH:MM) do agendador distribuído do acervo. */
  acervo_daily_slots: string[];
  created_at: string;
}
