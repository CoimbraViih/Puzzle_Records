// lib/posts/filterPosts.ts
import type {
  ContentSource,
  PostType,
  PostWithRelations,
} from "@/lib/types/post";

export interface PostFilters {
  /** Busca textual livre (manchete, legenda, música, fato). */
  query: string;
  socialAccountId: string | null;
  postType: PostType | null;
  contentSource: ContentSource | null;
}

export const EMPTY_POST_FILTERS: PostFilters = {
  query: "",
  socialAccountId: null,
  postType: null,
  contentSource: null,
};

export function hasActiveFilters(filters: PostFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.socialAccountId !== null ||
    filters.postType !== null ||
    filters.contentSource !== null
  );
}

/**
 * Normaliza para busca insensível a caixa e acentos ("LANÇAMENTO" casa
 * com "lancamento") — conteúdo do painel é pt-BR, acentuação varia entre
 * manchete gerada por IA e digitação manual.
 */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function matchesPostFilters(
  post: PostWithRelations,
  filters: PostFilters
): boolean {
  if (
    filters.socialAccountId !== null &&
    post.social_account_id !== filters.socialAccountId
  ) {
    return false;
  }
  if (filters.postType !== null && post.post_type !== filters.postType) {
    return false;
  }
  if (
    filters.contentSource !== null &&
    post.content_source !== filters.contentSource
  ) {
    return false;
  }

  const query = normalize(filters.query.trim());
  if (query === "") return true;

  const haystack = [
    post.headline,
    post.caption,
    post.track_name,
    post.source_fact,
    post.social_account?.display_name ?? null,
    post.social_account?.handle ?? null,
  ]
    .filter((part): part is string => part !== null)
    .map(normalize)
    .join("\n");

  return haystack.includes(query);
}
