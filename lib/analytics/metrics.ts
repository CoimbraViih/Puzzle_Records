import { createServiceClient } from "@/lib/supabase/service";
import { METRICS_COLLECTION_WINDOW_DAYS } from "./constants";

export interface PostForMetricsCollection {
  id: string;
  zernio_post_id: string;
}

export async function listPostsForMetricsCollection(): Promise<
  PostForMetricsCollection[]
> {
  const supabase = createServiceClient();
  const cutoff = new Date(
    Date.now() - METRICS_COLLECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // GET /v1/analytics do Zernio busca por postId (ID interno deles), não
  // pelo link público (post_url) — auditoria do M12 contra docs.zernio.com.
  const { data, error } = await supabase
    .from("posts")
    .select("id, zernio_post_id, published_at")
    .eq("status", "publicado")
    .not("zernio_post_id", "is", null)
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
    zernio_post_id: post.zernio_post_id as string,
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
      ...(metrics.likes !== null ? { likes: metrics.likes } : {}),
      ...(metrics.comments !== null ? { comments: metrics.comments } : {}),
      ...(metrics.reach !== null ? { reach: metrics.reach } : {}),
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
