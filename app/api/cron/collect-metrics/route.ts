import { NextResponse } from "next/server";

import { getPublishingProvider, PublishError } from "@/lib/publishing";
import {
  listPostsForMetricsCollection,
  recordMetricsError,
  upsertPostMetrics,
} from "@/lib/analytics/metrics";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const posts = await listPostsForMetricsCollection();
  const provider = getPublishingProvider();
  let collected = 0;

  for (const post of posts) {
    try {
      const metrics = await provider.getMetrics(post.zernio_post_id);
      await upsertPostMetrics(post.id, metrics);
      collected += 1;
    } catch (err) {
      const message =
        err instanceof PublishError
          ? err.message
          : "Erro inesperado ao coletar métricas via Zernio.";
      await recordMetricsError(post.id, message);
    }
  }

  return NextResponse.json({ collected, total: posts.length });
}
