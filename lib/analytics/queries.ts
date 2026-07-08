import { createClient } from "@/lib/supabase/server";
import { METRICS_COLLECTION_WINDOW_DAYS } from "./constants";

interface AggregatedRow {
  key: string;
  label: string;
  posts: number;
  likes: number;
  comments: number;
  reach: number;
}

export interface AnalyticsSummary {
  byAccount: AggregatedRow[];
  byArtist: AggregatedRow[];
  byHour: AggregatedRow[];
}

function accumulate(map: Map<string, AggregatedRow>, key: string, label: string, metrics: {
  likes: number | null;
  comments: number | null;
  reach: number | null;
}) {
  const existing = map.get(key) ?? { key, label, posts: 0, likes: 0, comments: 0, reach: 0 };
  existing.posts += 1;
  existing.likes += metrics.likes ?? 0;
  existing.comments += metrics.comments ?? 0;
  existing.reach += metrics.reach ?? 0;
  map.set(key, existing);
}

export async function listAnalyticsSummary(): Promise<AnalyticsSummary> {
  const supabase = await createClient();
  const cutoff = new Date(
    Date.now() - METRICS_COLLECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("post_metrics")
    .select(
      "likes, comments, reach, post:posts(scheduled_at, published_at, social_account:social_accounts(display_name), artist:artists(name))"
    )
    .gte("collected_at", cutoff)
    .not("collected_at", "is", null);

  if (error) {
    console.error("[analytics] falha ao buscar resumo de métricas:", error.message);
    return { byAccount: [], byArtist: [], byHour: [] };
  }

  const byAccount = new Map<string, AggregatedRow>();
  const byArtist = new Map<string, AggregatedRow>();
  const byHour = new Map<string, AggregatedRow>();

  for (const row of (data ?? []) as unknown as {
    likes: number | null;
    comments: number | null;
    reach: number | null;
    post: {
      scheduled_at: string | null;
      published_at: string | null;
      social_account: { display_name: string } | null;
      artist: { name: string } | null;
    } | null;
  }[]) {
    if (!row.post) continue;
    const metrics = { likes: row.likes, comments: row.comments, reach: row.reach };

    if (row.post.social_account) {
      accumulate(
        byAccount,
        row.post.social_account.display_name,
        row.post.social_account.display_name,
        metrics
      );
    }

    if (row.post.artist) {
      accumulate(byArtist, row.post.artist.name, row.post.artist.name, metrics);
    }

    const timestamp = row.post.scheduled_at ?? row.post.published_at;
    if (timestamp) {
      const hour = new Date(timestamp).getHours();
      const key = String(hour).padStart(2, "0");
      accumulate(byHour, key, `${key}h`, metrics);
    }
  }

  const sortByPosts = (a: AggregatedRow, b: AggregatedRow) => b.posts - a.posts;

  return {
    byAccount: Array.from(byAccount.values()).sort(sortByPosts),
    byArtist: Array.from(byArtist.values()).sort(sortByPosts),
    byHour: Array.from(byHour.values()).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
