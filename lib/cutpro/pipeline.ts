import type { SupabaseClient } from "@supabase/supabase-js";

import { getCutProProvider } from "./index";
import { CutProRateLimitError } from "./types";
import { probeVideo } from "./probeVideo";
import { downloadFromCutPro, relayUploadToCutPro } from "@/lib/renderWorker/cutproTransfer";

const MEDIA_BUCKET = "posts-media";

/** Só os campos que a máquina de estados do Cut.Pro precisa — deliberadamente
 * separado de DriveItemRow (lib/drive/queries.ts, usado pela UI) porque a
 * página /drive não precisa saber de cutpro_video_id/submission_id/render_id. */
export interface CutProDriveItem {
  id: string;
  filename: string;
  media_storage_path: string | null;
  edit_status: "nao_editado" | "enviando" | "clipando" | "aplicando" | "renderizando" | "editado" | "erro";
  cutpro_template_id: string | null;
  cutpro_video_id: string | null;
  cutpro_submission_id: string | null;
  cutpro_clip_id: string | null;
  cutpro_render_id: string | null;
}

function extensionFromPath(path: string): string {
  return path.split(".").pop() ?? "mp4";
}

async function markError(
  supabase: SupabaseClient,
  itemId: string,
  fromStatus: string,
  message: string
): Promise<void> {
  console.error(`[cutpro-pipeline] item ${itemId} (${fromStatus}) -> erro:`, message);
  await supabase
    .from("drive_items")
    .update({ edit_status: "erro", cutpro_error: message })
    .eq("id", itemId)
    .eq("edit_status", fromStatus);
}

/**
 * Avança UM item de `drive_items` um passo na máquina de estados do Cut.Pro
 * (M16/D4). Cada chamada faz só uma transição — o cron `cutpro-pipeline`
 * (5 min) chama isso por item elegível, mesmo espírito de polling do
 * `poll-video-render` (M14): nunca bloqueia dentro de uma execução do cron
 * esperando um job assíncrono do fornecedor terminar.
 *
 * `submitClipping` já aceita `template_id` direto (achado da validação
 * real da API, ver docs/plans/2026-07-15-m16-drive-cutpro.md) — os clipes
 * já saem com `has_template_applied: true`, então o estado `aplicando` não
 * é usado no caminho feliz (reservado só como fallback, hoje sem chamador).
 */
export async function advanceDriveItemEdit(
  supabase: SupabaseClient,
  item: CutProDriveItem
): Promise<void> {
  const cutpro = getCutProProvider();

  try {
    if (item.edit_status === "enviando") {
      await stepEnviando(supabase, item, cutpro);
      return;
    }
    if (item.edit_status === "clipando") {
      await stepClipando(supabase, item, cutpro);
      return;
    }
    if (item.edit_status === "renderizando") {
      await stepRenderizando(supabase, item, cutpro);
      return;
    }
  } catch (err) {
    if (err instanceof CutProRateLimitError) {
      // 429 BATCH_ALREADY_RUNNING — não é erro real, só tenta de novo no
      // próximo ciclo do cron (não grava cutpro_error nem muda edit_status).
      console.warn(`[cutpro-pipeline] item ${item.id} — rate limit, retry no próximo ciclo:`, err.message);
      return;
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido no pipeline Cut.Pro.";
    await markError(supabase, item.id, item.edit_status, message);
  }
}

async function stepEnviando(
  supabase: SupabaseClient,
  item: CutProDriveItem,
  cutpro: ReturnType<typeof getCutProProvider>
): Promise<void> {
  if (!item.media_storage_path) {
    await markError(supabase, item.id, "enviando", "Item sem mídia no Storage.");
    return;
  }
  if (!item.cutpro_template_id) {
    await markError(supabase, item.id, "enviando", "Item sem template Cut.Pro selecionado.");
    return;
  }

  if (item.cutpro_video_id) {
    // Upload já iniciado numa execução anterior (retomável) — só avança.
    const { error } = await supabase
      .from("drive_items")
      .update({ edit_status: "clipando" })
      .eq("id", item.id)
      .eq("edit_status", "enviando");
    if (error) console.error("[cutpro-pipeline] falha ao avançar enviando->clipando:", error);
    return;
  }

  const { data: mediaBlob, error: downloadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(item.media_storage_path);
  if (downloadError || !mediaBlob) {
    throw new Error(`Falha ao baixar mídia original do Storage: ${downloadError?.message}`);
  }
  const mediaBuffer = Buffer.from(await mediaBlob.arrayBuffer());
  const extension = extensionFromPath(item.media_storage_path);

  const probe = await probeVideo(mediaBuffer, extension);

  const upload = await cutpro.startUpload(item.filename, mediaBuffer.length, "video/mp4");

  const { data: signedUrlData, error: signError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(item.media_storage_path, 300);
  if (signError || !signedUrlData) {
    throw new Error(`Falha ao gerar URL assinada da mídia original: ${signError?.message}`);
  }

  await relayUploadToCutPro(signedUrlData.signedUrl, upload.uploadUrl);

  const completed = await cutpro.completeUpload(
    upload.videoId,
    item.filename,
    probe.durationSeconds,
    probe.width,
    probe.height
  );

  if (completed.forceWatermark) {
    await markError(
      supabase,
      item.id,
      "enviando",
      "O plano Cut.Pro atual gera vídeo com marca d'água (force_watermark=true) — confirme o plano contratado."
    );
    return;
  }

  const { error } = await supabase
    .from("drive_items")
    .update({ cutpro_video_id: upload.videoId, edit_status: "clipando", cutpro_error: null })
    .eq("id", item.id)
    .eq("edit_status", "enviando");
  if (error) console.error("[cutpro-pipeline] falha ao gravar cutpro_video_id:", error);
}

async function stepClipando(
  supabase: SupabaseClient,
  item: CutProDriveItem,
  cutpro: ReturnType<typeof getCutProProvider>
): Promise<void> {
  if (!item.cutpro_video_id) {
    await markError(supabase, item.id, "clipando", "Item sem cutpro_video_id (estado inconsistente).");
    return;
  }

  if (!item.cutpro_submission_id) {
    const submission = await cutpro.submitClipping(item.cutpro_video_id, {
      templateId: item.cutpro_template_id ?? undefined,
    });
    const { error } = await supabase
      .from("drive_items")
      .update({ cutpro_submission_id: submission.submissionId })
      .eq("id", item.id)
      .eq("edit_status", "clipando");
    if (error) console.error("[cutpro-pipeline] falha ao gravar cutpro_submission_id:", error);
    return;
  }

  const submission = await cutpro.getSubmission(item.cutpro_video_id, item.cutpro_submission_id);
  if (submission.status === "failed") {
    await markError(
      supabase,
      item.id,
      "clipando",
      submission.errorCode ?? "Clipagem por IA falhou (sem código de erro)."
    );
    return;
  }
  if (submission.status !== "completed") {
    return; // ainda processando — tenta de novo no próximo ciclo.
  }

  const clips = await cutpro.listClips(item.cutpro_video_id, item.cutpro_submission_id);
  const bestClip = [...clips].sort((a, b) => b.rating - a.rating)[0];
  if (!bestClip) {
    await markError(supabase, item.id, "clipando", "Clipagem concluída sem nenhum clipe gerado.");
    return;
  }

  const { error } = await supabase
    .from("drive_items")
    .update({ cutpro_clip_id: bestClip.id, edit_status: "renderizando" })
    .eq("id", item.id)
    .eq("edit_status", "clipando");
  if (error) console.error("[cutpro-pipeline] falha ao avançar clipando->renderizando:", error);
}

async function finalizeRender(
  supabase: SupabaseClient,
  item: CutProDriveItem,
  downloadUrl: string
): Promise<void> {
  const bytes = await downloadFromCutPro(downloadUrl);
  const editedPath = `cutpro-edited/${item.id}.mp4`;
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(editedPath, bytes, { contentType: "video/mp4", upsert: true });
  if (uploadError) {
    throw new Error(`Falha ao subir vídeo editado pro Storage: ${uploadError.message}`);
  }

  const { error } = await supabase
    .from("drive_items")
    .update({ edited_media_path: editedPath, edit_status: "editado", cutpro_error: null })
    .eq("id", item.id)
    .eq("edit_status", "renderizando");
  if (error) console.error("[cutpro-pipeline] falha ao gravar edited_media_path:", error);
}

async function stepRenderizando(
  supabase: SupabaseClient,
  item: CutProDriveItem,
  cutpro: ReturnType<typeof getCutProProvider>
): Promise<void> {
  if (!item.cutpro_video_id || !item.cutpro_submission_id || !item.cutpro_clip_id) {
    await markError(supabase, item.id, "renderizando", "Item sem clipe escolhido (estado inconsistente).");
    return;
  }

  if (!item.cutpro_render_id) {
    const render = await cutpro.renderClip(item.cutpro_video_id, item.cutpro_submission_id, item.cutpro_clip_id);
    if (render.hasWatermark) {
      await markError(supabase, item.id, "renderizando", "Render saiu com marca d'água (has_watermark=true).");
      return;
    }
    // from_cache/status "completed" já vem com download_url pronto — pula
    // direto pro download, sem precisar de outro ciclo de polling.
    if (render.status === "completed" && render.downloadUrl) {
      await finalizeRender(supabase, item, render.downloadUrl);
      return;
    }
    const { error } = await supabase
      .from("drive_items")
      .update({ cutpro_render_id: render.renderId })
      .eq("id", item.id)
      .eq("edit_status", "renderizando");
    if (error) console.error("[cutpro-pipeline] falha ao gravar cutpro_render_id:", error);
    return;
  }

  const status = await cutpro.getRenderStatus(item.cutpro_render_id);
  if (status.status === "failed" || status.status === "cancelled" || status.status === "expired") {
    await markError(supabase, item.id, "renderizando", `Render terminou com status "${status.status}".`);
    return;
  }
  if (status.status !== "completed") {
    return; // ainda renderizando — tenta de novo no próximo ciclo.
  }

  const { url } = await cutpro.getRenderDownloadUrl(item.cutpro_render_id);
  await finalizeRender(supabase, item, url);
}
