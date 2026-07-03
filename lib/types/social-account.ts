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
  created_at: string;
}
