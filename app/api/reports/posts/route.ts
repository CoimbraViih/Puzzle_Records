import { NextResponse } from "next/server";

import { toCsv } from "@/lib/reports/csv";
import {
  buildPostsReportRows,
  type PostReportInput,
} from "@/lib/reports/postsReport";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawDays = Number(url.searchParams.get("dias") ?? "30");
  const days = Number.isFinite(rawDays)
    ? Math.min(365, Math.max(1, Math.trunc(rawDays)))
    : 30;
  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, status, post_type, content_source, headline, caption, scheduled_at, published_at, post_url, created_at, social_account:social_accounts(display_name), metrics:post_metrics(likes, comments, reach)"
    )
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[reports] falha ao montar relatório de posts:", error.message);
    return NextResponse.json({ error: "report_failed" }, { status: 500 });
  }

  // post_metrics tem no máximo 1 linha por post (PK/unique post_id) —
  // o Supabase devolve como array; achata para objeto único.
  const inputs: PostReportInput[] = ((data ?? []) as unknown as (Omit<
    PostReportInput,
    "metrics"
  > & { metrics: PostReportInput["metrics"][] })[]).map((row) => ({
    ...row,
    metrics: Array.isArray(row.metrics) ? row.metrics[0] ?? null : row.metrics,
  }));

  const { headers, rows } = buildPostsReportRows(inputs);
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="posts-puzzle-${today}.csv"`,
    },
  });
}
