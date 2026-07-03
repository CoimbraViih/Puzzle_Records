export const POST_STATUSES = [
  "pendente",
  "rascunho",
  "pendente_aprovacao",
  "aprovado",
  "rejeitado",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  pendente: "Pendente (Drive)",
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
  social_account_id: string | null;
  template: PostTemplate | null;
  post_type: PostType;
  headline: string | null;
  caption: string | null;
  media_url: string;
  media_type: MediaType;
  status: PostStatus;
  scheduled_at: string | null;
  rejection_reason: string | null;
  /** Preenchido pelo M3 quando artista/conta social do Drive não têm match. */
  ingestion_warning: string | null;
  /** Preenchidos pelo M3 a partir do JSON de metadado; consumidos pelo M4. */
  source_fact: string | null;
  track_name: string | null;
  /** Preenchido pelo M4: todas as variações geradas (a 1ª sempre espelha headline/caption). */
  copy_variations: CopyVariation[] | null;
  /** Preenchido pelo M4 quando a geração de IA falha — nunca falha em silêncio. */
  copy_generation_error: string | null;
  /** Preenchido pelo M5: path no bucket posts-media da arte PNG renderizada (Template A ou B). */
  rendered_art_url: string | null;
  /** Preenchido pelo M5 quando a geração de arte falha — nunca falha em silêncio. */
  art_generation_error: string | null;
  created_by: string | null;
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
  } | null;
  /** Preenchido só pela camada de leitura (lib/posts/queries.ts). */
  media_signed_url?: string | null;
  /** Preenchido só pela camada de leitura (lib/posts/queries.ts). */
  rendered_art_signed_url?: string | null;
}

export interface CopyVariation {
  headline: string;
  caption: string;
}
