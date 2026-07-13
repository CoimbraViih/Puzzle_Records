import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getRenderJobStatus, RenderWorkerError } from "@/lib/renderWorker/client";

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
  const { data: pending, error } = await supabase
    .from("posts")
    .select("id, video_render_job_id")
    .eq("video_render_status", "processing")
    .not("video_render_job_id", "is", null);

  if (error) {
    console.error("[poll-video-render] falha ao buscar posts com render em andamento:", error.message);
    return NextResponse.json({ error: "falha ao consultar posts" }, { status: 500 });
  }

  let resolved = 0;

  for (const post of pending ?? []) {
    try {
      const status = await getRenderJobStatus(post.video_render_job_id as string);

      if (status.status === "processing") {
        continue;
      }

      if (status.status === "error") {
        await supabase
          .from("posts")
          .update({ video_render_status: "error", art_generation_error: status.error })
          .eq("id", post.id);
        continue;
      }

      const videoBuffer = Buffer.from(status.videoBase64, "base64");
      const artPath = `video-art-${post.id}-${Date.now()}.mp4`;
      const { error: uploadError } = await supabase.storage
        .from("posts-media")
        .upload(artPath, videoBuffer, { contentType: "video/mp4", upsert: false });

      if (uploadError) {
        await supabase
          .from("posts")
          .update({ video_render_status: "error", art_generation_error: `Falha ao subir o vídeo renderizado: ${uploadError.message}` })
          .eq("id", post.id);
        continue;
      }

      await supabase
        .from("posts")
        .update({ video_render_status: "done", rendered_art_url: artPath })
        .eq("id", post.id);
      resolved += 1;
    } catch (err) {
      const message = err instanceof RenderWorkerError ? err.message : "Erro inesperado ao resolver o render de vídeo.";
      await supabase
        .from("posts")
        .update({ video_render_status: "error", art_generation_error: message })
        .eq("id", post.id);
    }
  }

  return NextResponse.json({ resolved, total: (pending ?? []).length });
}
