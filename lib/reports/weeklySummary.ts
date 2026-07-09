import { createServiceClient } from "@/lib/supabase/service";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklySummary {
  weekStartIso: string;
  weekEndIso: string;
  publishedCount: number;
  approvedPendingCount: number;
  failedCount: number;
  disconnectedAccounts: string[];
  topPosts: {
    headline: string | null;
    caption: string | null;
    artistName: string | null;
    likes: number;
    comments: number;
    postUrl: string | null;
  }[];
  byAccount: {
    account: string;
    published: number;
    likes: number;
    comments: number;
    reach: number;
  }[];
}

export async function buildWeeklySummary(): Promise<
  WeeklySummary | { error: string }
> {
  const supabase = createServiceClient();
  const weekEnd = new Date();
  const weekStart = new Date(weekEnd.getTime() - WEEK_MS);

  const { data: published, error: publishedError } = await supabase
    .from("posts")
    .select(
      "headline, caption, post_url, published_at, artist:artists(name), social_account:social_accounts(display_name), metrics:post_metrics(likes, comments, reach)"
    )
    .eq("status", "publicado")
    .gte("published_at", weekStart.toISOString());

  if (publishedError) {
    return { error: `Falha ao buscar posts publicados: ${publishedError.message}` };
  }

  const [approvedRes, failedRes, disconnectedRes] = await Promise.all([
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "aprovado"),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .not("publish_error", "is", null),
    supabase
      .from("social_accounts")
      .select("display_name")
      .eq("connection_status", "desconectada"),
  ]);

  if (approvedRes.error) {
    console.error(
      "[weekly-report] falha ao contar posts aprovados pendentes:",
      approvedRes.error.message
    );
  }
  if (failedRes.error) {
    console.error(
      "[weekly-report] falha ao contar posts com erro de publicação:",
      failedRes.error.message
    );
  }
  if (disconnectedRes.error) {
    console.error(
      "[weekly-report] falha ao buscar contas desconectadas:",
      disconnectedRes.error.message
    );
  }

  type Row = {
    headline: string | null;
    caption: string | null;
    post_url: string | null;
    published_at: string | null;
    artist: { name: string } | null;
    social_account: { display_name: string } | null;
    metrics: { likes: number | null; comments: number | null; reach: number | null }[];
  };
  const rows = (published ?? []) as unknown as Row[];

  const byAccountMap = new Map<string, WeeklySummary["byAccount"][number]>();
  const scored = rows.map((row) => {
    const m = row.metrics?.[0] ?? null;
    const likes = m?.likes ?? 0;
    const comments = m?.comments ?? 0;
    const reach = m?.reach ?? 0;
    const account = row.social_account?.display_name ?? "Sem conta";
    const acc = byAccountMap.get(account) ?? {
      account,
      published: 0,
      likes: 0,
      comments: 0,
      reach: 0,
    };
    acc.published += 1;
    acc.likes += likes;
    acc.comments += comments;
    acc.reach += reach;
    byAccountMap.set(account, acc);
    return { row, likes, comments };
  });

  const topPosts = scored
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 5)
    .map(({ row, likes, comments }) => ({
      headline: row.headline,
      caption: row.caption,
      artistName: row.artist?.name ?? null,
      likes,
      comments,
      postUrl: row.post_url,
    }));

  return {
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    publishedCount: rows.length,
    approvedPendingCount: approvedRes.count ?? 0,
    failedCount: failedRes.count ?? 0,
    disconnectedAccounts: (disconnectedRes.data ?? []).map(
      (a) => a.display_name
    ),
    topPosts,
    byAccount: Array.from(byAccountMap.values()).sort(
      (a, b) => b.published - a.published
    ),
  };
}
