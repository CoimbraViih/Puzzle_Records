import { createServiceClient } from "@/lib/supabase/service";

// Sentinela gravada em publish_error enquanto um post está sendo publicado
// (claim atômico contra execuções concorrentes do cron). Não é um erro real
// e não deve ser contada como falha de publicação.
export const PUBLISHING_CLAIM_SENTINEL = "Publicando...";

export interface PostPendingPublish {
  id: string;
  caption: string;
  rendered_art_url: string;
  media_type: "image" | "video";
  /** Não-nulo quando uma tentativa anterior já submeteu o post ao provedor
   * mas não chegou a resolver (ver PublishingProvider.resolvePendingPublish)
   * — quando presente, o cron deve reconsultar em vez de reenviar. */
  zernio_post_id: string | null;
  social_account_id: string | null;
  social_account: {
    zernio_account_id: string | null;
    network: string;
    display_name: string;
  } | null;
}


export async function listPostsPendingPublish(): Promise<
  PostPendingPublish[]
> {
  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, caption, rendered_art_url, media_type, zernio_post_id, content_source, scheduled_at, social_account_id, social_account:social_accounts(zernio_account_id, network, display_name)"
    )
    .eq("status", "aprovado")
    .not("rendered_art_url", "is", null)
    .not("caption", "is", null)
    .is("publish_error", null)
    .is("post_url", null);

  if (error) {
    console.error(
      "[pendingPublish] falha ao buscar posts pendentes de publicação:",
      error.message
    );
    return [];
  }

  const now = new Date(nowIso).getTime();

  const eligible = (
    (data ?? []) as unknown as (PostPendingPublish & {
      content_source: string | null;
      scheduled_at: string | null;
    })[]
  ).filter((post) => {
    const scheduledAt = post.scheduled_at
      ? new Date(post.scheduled_at).getTime()
      : null;

    if (post.content_source === "acervo") {
      // Posts do acervo só ficam elegíveis depois que o cron acervo-schedule
      // atribui um scheduled_at (distribuição por slot + anti-repetição).
      // scheduled_at nulo aqui NÃO significa "publicar agora".
      return scheduledAt !== null && scheduledAt <= now;
    }

    // Posts vindos do Drive mantêm o comportamento original: sem
    // scheduled_at significa publicar assim que aprovado.
    return scheduledAt === null || scheduledAt <= now;
  });

  return eligible.map(
    ({
      id,
      caption,
      rendered_art_url,
      media_type,
      zernio_post_id,
      social_account_id,
      social_account,
    }) => ({
      id,
      caption,
      rendered_art_url,
      media_type,
      zernio_post_id,
      social_account_id,
      social_account,
    })
  );
}
