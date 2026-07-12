import { createClient } from "@/lib/supabase/server";
import type { PostWithRelations } from "@/lib/types/post";
import type { SocialAccount } from "@/lib/types/social-account";

export async function listPosts(): Promise<PostWithRelations[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "*, social_account:social_accounts(id, network, handle, display_name)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Falha ao listar posts:", error);
    return [];
  }

  const posts = (data as PostWithRelations[]) ?? [];
  if (posts.length === 0) return posts;

  // Um único round-trip ao Storage para os paths de mídia e de arte renderizada
  // (ambos vivem no bucket posts-media). Os paths de arte são intercalados só
  // para os posts que já têm `rendered_art_url` preenchido.
  const mediaPaths = posts.map((post) => post.media_url);
  const artPathEntries = posts
    .map((post, index) => ({ index, path: post.rendered_art_url }))
    .filter(
      (entry): entry is { index: number; path: string } => entry.path !== null
    );

  const { data: signedUrls, error: signedUrlsError } = await supabase.storage
    .from("posts-media")
    .createSignedUrls(
      [...mediaPaths, ...artPathEntries.map((entry) => entry.path)],
      60 * 60
    );

  if (signedUrlsError) {
    console.error("Falha ao gerar URLs assinadas da mídia:", signedUrlsError);
    return posts;
  }

  const artSignedUrlByPostIndex = new Map<number, string | null>();
  artPathEntries.forEach((entry, artIndex) => {
    artSignedUrlByPostIndex.set(
      entry.index,
      signedUrls?.[mediaPaths.length + artIndex]?.signedUrl ?? null
    );
  });

  return posts.map((post, index) => ({
    ...post,
    media_signed_url: signedUrls?.[index]?.signedUrl ?? null,
    rendered_art_signed_url: artSignedUrlByPostIndex.get(index) ?? null,
  }));
}

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("*")
    .order("display_name", { ascending: true });

  if (error) {
    console.error("Falha ao listar contas sociais:", error);
    return [];
  }

  return (data as SocialAccount[]) ?? [];
}
