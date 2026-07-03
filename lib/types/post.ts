export const POST_STATUSES = [
  "rascunho",
  "pendente_aprovacao",
  "aprovado",
  "rejeitado",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente de aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

export const POST_TEMPLATES = ["A", "B"] as const;
export type PostTemplate = (typeof POST_TEMPLATES)[number];

export const POST_TYPES = [
  "viral_geral",
  "noticia_funk",
  "lancamento",
] as const;

export type PostType = (typeof POST_TYPES)[number];

export const POST_TYPE_LABELS: Record<PostType, string> = {
  viral_geral: "Viral geral",
  noticia_funk: "Notícia funk",
  lancamento: "Lançamento",
};

export const MEDIA_TYPES = ["image", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface Post {
  id: string;
  artist_id: string | null;
  social_account_id: string;
  template: PostTemplate;
  post_type: PostType;
  headline: string;
  caption: string;
  media_url: string;
  media_type: MediaType;
  status: PostStatus;
  scheduled_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostWithRelations extends Post {
  artist: { id: string; name: string; handle: string } | null;
  social_account: {
    id: string;
    network: string;
    handle: string;
    display_name: string;
  };
  /** Preenchido só pela camada de leitura (lib/posts/queries.ts). */
  media_signed_url?: string | null;
}
