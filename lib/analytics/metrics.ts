import { createServiceClient } from "@/lib/supabase/service";
import { METRICS_COLLECTION_WINDOW_DAYS } from "./constants";

export interface PostForMetricsCollection {
  id: string;
  post_url: string;
}

export async function listPostsForMetricsCollection(): Promise<
  PostForMetricsCollection[]
> {
  const supabase = createServiceClient();
  const cutoff = new Date(
    Date.now() - METRICS_COLLECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select("id, post_url, published_at")
    .eq("status", "publicado")
    .not("post_url", "is", null)
    .gte("published_at", cutoff);

  if (error) {
    console.error(
      "[collect-metrics] falha ao buscar posts publicados:",
      error.message
    );
    return [];
  }

  return (data ?? []).map((post) => ({
    id: post.id,
    post_url: post.post_url as string,
  }));
}

export async function upsertPostMetrics(
  postId: string,
  metrics: { likes: number | null; comments: number | null; reach: number | null }
) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("post_metrics").upsert(
    {
      post_id: postId,
      likes: metrics.likes,
      comments: metrics.comments,
      reach: metrics.reach,
      collected_at: new Date().toISOString(),
      metrics_error: null,
    },
    { onConflict: "post_id" }
  );

  if (error) {
    console.error(
      `[collect-metrics] falha ao gravar metricas do post ${postId}:`,
      error.message
    );
  }
}

export async function recordMetricsError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("post_metrics")
    .upsert(
      { post_id: postId, metrics_error: message, collected_at: new Date().toISOString() },
      { onConflict: "post_id", ignoreDuplicates: false }
    );

  if (error) {
    console.error(
      `[collect-metrics] falha ao gravar metrics_error do post ${postId}:`,
      error.message
    );
  }
}
