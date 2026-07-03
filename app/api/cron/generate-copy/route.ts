import { NextResponse } from "next/server";

import {
  CopyGenerationError,
  generateCopyVariations,
} from "@/lib/openai/generateCopy";
import { listPostsPendingCopy } from "@/lib/posts/pendingCopy";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const posts = await listPostsPendingCopy(supabase);

  let generated = 0;
  for (const post of posts) {
    try {
      const variations = await generateCopyVariations({
        postType: post.post_type,
        fact: post.source_fact,
        trackName: post.track_name,
        artistName: post.artist?.name ?? null,
        artistHandle: post.artist?.handle ?? null,
      });

      const { error } = await supabase
        .from("posts")
        .update({
          headline: variations[0].headline,
          caption: variations[0].caption,
          copy_variations: variations,
        })
        .eq("id", post.id);

      if (error) {
        console.error("Falha ao salvar manchete/legenda geradas:", post.id, error);
        continue;
      }
      generated += 1;
    } catch (err) {
      const message =
        err instanceof CopyGenerationError
          ? err.message
          : "Falha ao gerar manchete/legenda via OpenAI.";
      console.error("Erro na geração de IA para o post:", post.id, err);
      await supabase
        .from("posts")
        .update({ copy_generation_error: message })
        .eq("id", post.id);
    }
  }

  return NextResponse.json({ generated, total: posts.length });
}
