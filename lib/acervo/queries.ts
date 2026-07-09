import { classifyAcervoState } from "@/lib/acervo/classify";
import { listPosts } from "@/lib/posts/queries";
import type { PostWithRelations } from "@/lib/types/post";

export { classifyAcervoState, type AcervoState } from "./classify";

export async function listAcervoPosts(): Promise<PostWithRelations[]> {
  const posts = await listPosts();
  return posts.filter((post) => classifyAcervoState(post) !== null);
}
