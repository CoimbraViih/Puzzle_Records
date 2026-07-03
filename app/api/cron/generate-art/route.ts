import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listPostsPendingArt } from "@/lib/posts/pendingArt";
import { renderArt, ArtRenderError } from "@/lib/renderer/renderArt";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function recordArtError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ art_generation_error: message })
    .eq("id", postId);
  if (error) {
    console.error(`[generate-art] falha ao gravar art_generation_error do post ${postId}:`, error.message);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pending = await listPostsPendingArt();
  const supabase = createServiceClient();
  let generated = 0;

  for (const post of pending) {
    try {
      const artPath = await renderArt({
        postId: post.id,
        template: post.template,
        headline: post.headline,
        mediaUrl: post.media_url,
        mediaType: post.media_type,
      });

      const { error } = await supabase
        .from("posts")
        .update({ rendered_art_url: artPath })
        .eq("id", post.id);

      if (error) {
        console.error(`[generate-art] falha ao gravar rendered_art_url do post ${post.id}:`, error.message);
        continue;
      }
      generated += 1;
    } catch (err) {
      const message = err instanceof ArtRenderError ? err.message : "Erro inesperado ao gerar a arte.";
      await recordArtError(post.id, message);
    }
  }

  return NextResponse.json({ generated, total: pending.length });
}
