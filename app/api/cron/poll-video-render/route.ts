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
        // Claim atômico: só grava "error" se o post ainda estiver "processing".
        // Se outra invocação já resolveu este post primeiro, o update abaixo
        // afeta 0 linhas — não há nada a fazer além de seguir adiante.
        await supabase
          .from("posts")
          .update({ video_render_status: "error", art_generation_error: status.error })
          .eq("id", post.id)
          .eq("video_render_status", "processing")
          .select("id");
        continue;
      }

      const videoBuffer = Buffer.from(status.videoBase64, "base64");
      const artPath = `video-art-${post.id}-${Date.now()}.mp4`;
      const { error: uploadError } = await supabase.storage
        .from("posts-media")
        .upload(artPath, videoBuffer, { contentType: "video/mp4", upsert: false });

      if (uploadError) {
        // Mesmo claim atômico: se outra invocação já resolveu este post primeiro,
        // este update afeta 0 linhas e não sobrescreve o estado vencedor.
        await supabase
          .from("posts")
          .update({ video_render_status: "error", art_generation_error: `Falha ao subir o vídeo renderizado: ${uploadError.message}` })
          .eq("id", post.id)
          .eq("video_render_status", "processing")
          .select("id");
        continue;
      }

      // Claim atômico: só grava "done" se o post ainda estiver "processing" no
      // momento do update. Se outra invocação concorrente já resolveu este post
      // primeiro, a cláusula .eq() abaixo faz o update afetar 0 linhas — detectamos
      // isso pelo array `data` vazio e não contamos o post como resolvido por esta
      // execução (evita nondeterminismo de qual upload "vence" como rendered_art_url).
      const { data: claimed } = await supabase
        .from("posts")
        .update({ video_render_status: "done", rendered_art_url: artPath })
        .eq("id", post.id)
        .eq("video_render_status", "processing")
        .select("id");

      if (!claimed || claimed.length === 0) {
        // Outra invocação já marcou este post como resolvido primeiro — o upload
        // feito aqui fica órfão no Storage, mas não sobrescrevemos o estado vencedor.
        continue;
      }

      resolved += 1;
    } catch (err) {
      const message = err instanceof RenderWorkerError ? err.message : "Erro inesperado ao resolver o render de vídeo.";
      await supabase
        .from("posts")
        .update({ video_render_status: "error", art_generation_error: message })
        .eq("id", post.id)
        .eq("video_render_status", "processing")
        .select("id");
    }
  }

  return NextResponse.json({ resolved, total: (pending ?? []).length });
}
