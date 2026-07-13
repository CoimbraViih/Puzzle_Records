import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listPostsPendingVideoArt } from "@/lib/posts/pendingVideoArt";
import { getDefaultVideoTemplate } from "@/lib/templates/queries";
import { transcribeWithWordTimestamps, VideoAnalysisError } from "@/lib/openai/videoAnalysis";
import { submitRenderJob, RenderWorkerError } from "@/lib/renderWorker/client";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function recordError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ art_generation_error: message })
    .eq("id", postId);
  if (error) {
    console.error(`[generate-video-art] falha ao gravar art_generation_error do post ${postId}:`, error.message);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [pending, template] = await Promise.all([
    listPostsPendingVideoArt(),
    getDefaultVideoTemplate(),
  ]);

  if (!template) {
    return NextResponse.json({ error: "nenhum template de vídeo default configurado" }, { status: 500 });
  }

  const supabase = createServiceClient();
  let submitted = 0;

  for (const post of pending) {
    try {
      const { data: signedUrlData, error: signError } = await supabase.storage
        .from("posts-media")
        .createSignedUrl(post.media_url, 60 * 30);
      if (signError || !signedUrlData) {
        throw new RenderWorkerError(`Não foi possível gerar URL assinada do vídeo: ${signError?.message ?? "desconhecido"}`);
      }

      const videoResponse = await fetch(signedUrlData.signedUrl);
      if (!videoResponse.ok) {
        throw new RenderWorkerError(`Falha ao baixar o vídeo original (status ${videoResponse.status}).`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      const words = await transcribeWithWordTimestamps(videoBuffer, post.media_url);

      const { jobId } = await submitRenderJob({
        postId: post.id,
        videoUrl: signedUrlData.signedUrl,
        headline: post.headline,
        words,
        config: template.config,
        logoUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/puzzle-records-logo.svg`,
      });

      const { error } = await supabase
        .from("posts")
        .update({ video_template_id: template.id, video_render_job_id: jobId, video_render_status: "processing" })
        .eq("id", post.id);

      if (error) {
        console.error(`[generate-video-art] falha ao gravar video_render_job_id do post ${post.id}:`, error.message);
        continue;
      }
      submitted += 1;
    } catch (err) {
      const message =
        err instanceof VideoAnalysisError || err instanceof RenderWorkerError
          ? err.message
          : "Erro inesperado ao submeter o render de vídeo.";
      await recordError(post.id, message);
    }
  }

  return NextResponse.json({ submitted, total: pending.length });
}
