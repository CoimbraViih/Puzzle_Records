import type { SupabaseClient } from "@supabase/supabase-js";

import type { MediaType, PostType } from "@/lib/types/post";

export interface PostPendingCopy {
  id: string;
  post_type: PostType;
  source_fact: string | null;
  track_name: string | null;
  media_url: string;
  media_type: MediaType;
}

/**
 * Posts que ainda não têm manchete/legenda e nunca falharam ao gerar
 * (copy_generation_error é null).
 */
export async function listPostsPendingCopy(
  supabase: SupabaseClient
): Promise<PostPendingCopy[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, post_type, source_fact, track_name, media_url, media_type")
    .eq("status", "pendente")
    .is("headline", null)
    .is("copy_generation_error", null);

  if (error) {
    console.error("Falha ao listar posts pendentes de manchete/legenda:", error);
    return [];
  }

  return (data as PostPendingCopy[]) ?? [];
}
