import { listPosts } from "@/lib/posts/queries";
import type { PostWithRelations } from "@/lib/types/post";

export type AcervoState = "novo" | "agendado" | "publicado";

export function classifyAcervoState(post: PostWithRelations): AcervoState | null {
  if (post.content_source !== "acervo") return null;
  if (post.status === "publicado") return "publicado";
  if (post.status === "aprovado") {
    return post.scheduled_at ? "agendado" : "novo";
  }
  return null;
}

export async function listAcervoPosts(): Promise<PostWithRelations[]> {
  const posts = await listPosts();
  return posts.filter((post) => classifyAcervoState(post) !== null);
}
