import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CopyGenerationError,
  generateCopyVariations,
} from "@/lib/openai/generateCopy";
import { listPostsPendingCopy, type PostPendingCopy } from "@/lib/posts/pendingCopy";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Grava o erro de geração no post. Se essa própria escrita falhar, loga
 * explicitamente — sem isso, o post fica sem `source_fact` nem
 * `copy_generation_error` e o cron tentaria reprocessá-lo pra sempre em
 * silêncio (contraria a regra de nunca falhar em silêncio do docs/CLAUDE.md).
 */
async function recordCopyGenerationError(
  supabase: SupabaseClient,
  postId: string,
  message: string
): Promise<void> {
  const { error } = await supabase
    .from("posts")
    .update({ copy_generation_error: message })
    .eq("id", postId);

  if (error) {
    console.error(
      "Falha ao gravar copy_generation_error (post ficará sem manchete e sem erro visível):",
      postId,
      error
    );
  }
}

async function downloadMedia(
  supabase: SupabaseClient,
  path: string
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from("posts-media").download(path);
  if (error || !data) {
    throw new Error("Falha ao baixar mídia do Storage pra análise de vídeo.");
  }
  return Buffer.from(await data.arrayBuffer());
}

async function generateForPost(supabase: SupabaseClient, post: PostPendingCopy) {
  if (post.media_type === "video") {
    const videoBuffer = await downloadMedia(supabase, post.media_url);
    return generateCopyVariations({
      mode: "video",
      postType: post.post_type,
      trackName: post.track_name,
      additionalContext: post.source_fact,
      videoBuffer,
      filename: post.media_url,
    });
  }

  return generateCopyVariations({
    mode: "text",
    postType: post.post_type,
    fact: post.source_fact!,
    trackName: post.track_name,
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const posts = await listPostsPendingCopy(supabase);

  let generated = 0;
  for (const post of posts) {
    if (post.media_type === "image" && !post.source_fact) {
      console.error("Imagem pendente sem source_fact, não é possível gerar copy:", post.id);
      await recordCopyGenerationError(
        supabase,
        post.id,
        "Imagem sem contexto (source_fact vazio)."
      );
      continue;
    }

    try {
      const variations = await generateForPost(supabase, post);

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
      await recordCopyGenerationError(supabase, post.id, message);
    }
  }

  return NextResponse.json({ generated, total: posts.length });
}
