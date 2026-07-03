import { createClient } from "@/lib/supabase/server";
import type { Artist } from "@/lib/types/artist";
import type { PostWithRelations } from "@/lib/types/post";
import type { SocialAccount } from "@/lib/types/social-account";

export async function listPosts(): Promise<PostWithRelations[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "*, artist:artists(id, name, handle), social_account:social_accounts(id, network, handle, display_name)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Falha ao listar posts:", error);
    return [];
  }

  const posts = (data as PostWithRelations[]) ?? [];
  if (posts.length === 0) return posts;

  const { data: signedUrls, error: signedUrlsError } = await supabase.storage
    .from("posts-media")
    .createSignedUrls(
      posts.map((post) => post.media_url),
      60 * 60
    );

  if (signedUrlsError) {
    console.error("Falha ao gerar URLs assinadas da mídia:", signedUrlsError);
    return posts;
  }

  return posts.map((post, index) => ({
    ...post,
    media_signed_url: signedUrls?.[index]?.signedUrl ?? null,
  }));
}

export async function listArtists(): Promise<Artist[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("Falha ao listar artistas:", error);
    return [];
  }

  return (data as Artist[]) ?? [];
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
