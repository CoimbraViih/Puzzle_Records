import { CUTPRO_BUSY_EDIT_STATUSES } from "@/lib/cutpro/labels";
import { createServiceClient } from "@/lib/supabase/service";

export interface PostPendingVideoArt {
  id: string;
  headline: string;
  media_url: string;
}

export async function listPostsPendingVideoArt(): Promise<PostPendingVideoArt[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id, headline, media_url")
    .eq("media_type", "video")
    .not("headline", "is", null)
    .is("video_render_job_id", null)
    .is("rendered_art_url", null)
    .is("art_generation_error", null)
    // Post que o usuário mandou pro fluxo Cut.Pro (edit_status em
    // enviando/clipando/renderizando) não pode ser pego em paralelo pelo
    // pipeline Remotion nativo — duas máquinas de estado de vídeo
    // competindo pela mesma linha (achado da auditoria de 29/07/2026).
    .not("edit_status", "in", `(${CUTPRO_BUSY_EDIT_STATUSES.join(",")})`);

  if (error) {
    console.error("[pendingVideoArt] falha ao buscar posts pendentes de render de vídeo:", error.message);
    return [];
  }

  return (data ?? []) as PostPendingVideoArt[];
}
