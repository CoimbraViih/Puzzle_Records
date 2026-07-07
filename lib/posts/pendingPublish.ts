import { createServiceClient } from "@/lib/supabase/service";

export interface PostPendingPublish {
  id: string;
  caption: string;
  rendered_art_url: string;
  social_account: { zernio_account_id: string | null } | null;
}


export async function listPostsPendingPublish(): Promise<
  PostPendingPublish[]
> {
  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, caption, rendered_art_url, social_account:social_accounts(zernio_account_id)"
    )
    .eq("status", "aprovado")
    .not("rendered_art_url", "is", null)
    .not("caption", "is", null)
    .is("publish_error", null)
    .is("post_url", null)
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);

  if (error) {
    console.error(
      "[pendingPublish] falha ao buscar posts pendentes de publicação:",
      error.message
    );
    return [];
  }

  return (data ?? []) as unknown as PostPendingPublish[];
}
