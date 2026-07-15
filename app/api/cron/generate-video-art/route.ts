import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listPostsPendingVideoArt } from "@/lib/posts/pendingVideoArt";
import { getDefaultVideoTemplateForCron } from "@/lib/templates/queries";
import { transcribeWithWordTimestamps, VideoAnalysisError } from "@/lib/openai/videoAnalysis";
import { submitRenderJob, RenderWorkerError } from "@/lib/renderWorker/client";

// Baixa o vídeo original + transcreve via Whisper (mesmo custo de tempo que
// justificou maxDuration=300 no cron generate-copy, ver ali) antes de
// submeter o job de render — sem isso a função é derrubada pelo limite
// padrão da Vercel (10-15s) no meio da transcrição, e o post nunca sai do
// estado "pendente de render de vídeo" (nenhum erro é gravado, porque a
// função é encerrada abruptamente antes do catch rodar).
export const maxDuration = 300;

// Mesmo raciocínio do generate-copy: o loop abaixo é sequencial e cada vídeo
// (download + Whisper) pode levar 20-60s — 2-3 pendentes no mesmo ciclo
// excederiam maxDuration=300. Vídeos além do limite ficam pendentes pro
// próximo ciclo (5 min depois), sem gravar erro.
const MAX_VIDEOS_PER_RUN = 3;

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

/**
 * O motor de render real (Remotion, M14) exige tanto um template default
 * quanto transcrição com timestamps por palavra via Whisper da OpenAI —
 * indisponível hoje sem template configurado e/ou rodando no fallback
 * OpenRouter (que não suporta response_format "verbose_json", ver
 * lib/openai/videoAnalysis.ts). Sem esse fallback, qualquer uma dessas
 * duas falhas trava o post pra sempre em "aprovado" sem nenhum erro
 * visível (rendered_art_url nunca preenchido = nunca elegível em
 * pendingPublish.ts, e listPostsPendingVideoArt já exclui posts com
 * art_generation_error, então não há retry automático mesmo). Publica o
 * vídeo bruto em vez disso — assim que o pipeline real funcionar de novo
 * (template configurado + chave OpenAI real), esse fallback para de ser
 * necessário porque o post nunca mais entra em erro.
 */
async function fallbackToRawVideo(
  supabase: ReturnType<typeof createServiceClient>,
  postId: string,
  mediaUrl: string,
  reason: string
) {
  console.error(`[generate-video-art] caindo pro vídeo bruto no post ${postId} (${reason})`);
  const { error } = await supabase
    .from("posts")
    .update({ rendered_art_url: mediaUrl })
    .eq("id", postId);
  if (error) {
    console.error(`[generate-video-art] falha ao gravar fallback de vídeo bruto do post ${postId}:`, error.message);
    await recordError(postId, `Falha ao aplicar fallback de vídeo (${reason}): ${error.message}`);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [pending, template] = await Promise.all([
    listPostsPendingVideoArt(),
    getDefaultVideoTemplateForCron(),
  ]);

  const supabase = createServiceClient();

  if (!template) {
    for (const post of pending) {
      await fallbackToRawVideo(supabase, post.id, post.media_url, "nenhum template de vídeo default configurado");
    }
    return NextResponse.json({ submitted: 0, fallbackRawVideo: pending.length, total: pending.length });
  }

  let submitted = 0;
  let fallbackRawVideo = 0;

  for (const post of pending.slice(0, MAX_VIDEOS_PER_RUN)) {
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
        await recordError(post.id, `Job de render (${jobId}) submetido, mas falha ao gravar no post: ${error.message}`);
        continue;
      }
      submitted += 1;
    } catch (err) {
      const message =
        err instanceof VideoAnalysisError || err instanceof RenderWorkerError
          ? err.message
          : "Erro inesperado ao submeter o render de vídeo.";
      await fallbackToRawVideo(supabase, post.id, post.media_url, message);
      fallbackRawVideo += 1;
    }
  }

  return NextResponse.json({ submitted, fallbackRawVideo, total: pending.length });
}
