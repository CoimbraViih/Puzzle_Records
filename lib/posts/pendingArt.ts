import { createServiceClient } from "@/lib/supabase/service";

export interface PostPendingArt {
  id: string;
  template: "A" | "B";
  headline: string;
  media_url: string;
  media_type: "image" | "video";
}

export async function listPostsPendingArt(): Promise<PostPendingArt[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id, template, headline, media_url, media_type")
    .not("headline", "is", null)
    .not("template", "is", null)
    .is("rendered_art_url", null)
    .is("art_generation_error", null);

  if (error) {
    console.error("[pendingArt] falha ao buscar posts pendentes de arte:", error.message);
    return [];
  }

  return (data ?? []) as PostPendingArt[];
}
