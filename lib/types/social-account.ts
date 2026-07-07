export const SOCIAL_NETWORKS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const CONNECTION_STATUSES = ["conectada", "desconectada"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

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
  /** Preenchido pelo M9: sinalizado via falhas consecutivas de publicação (sem endpoint de status do Zernio). */
  connection_status: ConnectionStatus;
  /** Preenchido pelo M9: zerado a cada publicação bem-sucedida na conta. */
  consecutive_publish_failures: number;
  /** Preenchido pelo M9: idempotência do alerta de desconexão. */
  disconnected_alert_sent_at: string | null;
  created_at: string;
}
