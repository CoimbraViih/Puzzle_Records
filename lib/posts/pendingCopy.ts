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
    .is("copy_generation_error", null)
    // Posts do workflow n8n "Puzzle Records — Drive → Instagram" (content_source
    // "n8n") são legendados pelo próprio n8n (Agente de Legendas) — não devem
    // ser pegos pela geração nativa (mesmo padrão de fetchEligibleItems em
    // app/api/cron/cutpro-pipeline/route.ts, ver docs/CLAUDE.md).
    .neq("content_source", "n8n");

  if (error) {
    console.error("Falha ao listar posts pendentes de manchete/legenda:", error);
    return [];
  }

  return (data as PostPendingCopy[]) ?? [];
}
