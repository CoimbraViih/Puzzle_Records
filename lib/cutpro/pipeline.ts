import type { SupabaseClient } from "@supabase/supabase-js";

import { getCutProProvider } from "./index";
import { CutProRateLimitError } from "./types";
import { probeVideo } from "./probeVideo";

const MEDIA_BUCKET = "posts-media";

/** As duas tabelas que podem ter um item em edição pelo Cut.Pro — ver
 * docs/superpowers/specs/2026-07-19-cutpro-template-editing-todos-fluxos-design.md.
 * `drive_items` é o fluxo curado original do Drive (M16); `posts` cobre
 * Post rápido/Novo post e cadastro manual de acervo, que criam o post
 * direto (sem passar por drive_items) mas têm as mesmas colunas de
 * estado do Cut.Pro (migration 0028). */
export type CutProTable = "drive_items" | "posts";

/** Só os campos que a máquina de estados do Cut.Pro precisa — deliberadamente
 * separado de DriveItemRow (lib/drive/queries.ts, usado pela UI) porque a
 * página /drive não precisa saber de cutpro_video_id/submission_id/render_id.
 * Pra `posts`, a query que monta essa linha usa alias (`media_url` vira
 * `media_storage_path`, `media_url` também vira `filename` — posts não tem
 * um "nome de arquivo" separado do path de Storage, e o path já sai com a
 * extensão certa) — ver app/api/cron/cutpro-pipeline/route.ts. */
export interface CutProEditableRow {
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
  table: CutProTable,
  itemId: string,
  fromStatus: string,
  message: string
): Promise<void> {
  console.error(`[cutpro-pipeline] ${table} ${itemId} (${fromStatus}) -> erro:`, message);
  await supabase
    .from(table)
    .update({ edit_status: "erro", cutpro_error: message })
    .eq("id", itemId)
    .eq("edit_status", fromStatus);
}

/**
 * Avança UM item (de `drive_items` ou `posts`) um passo na máquina de
 * estados do Cut.Pro (M16/D4, generalizada em 19/07/2026 pra também cobrir
 * `posts`). Cada chamada faz só uma transição — o cron `cutpro-pipeline`
 * (5 min) chama isso por item elegível, mesmo espírito de polling do
 * `poll-video-render` (M14): nunca bloqueia dentro de uma execução do cron
 * esperando um job assíncrono do fornecedor terminar.
 *
 * `submitClipping` já aceita `template_id` direto (achado da validação
 * real da API, ver docs/plans/2026-07-15-m16-drive-cutpro.md) — os clipes
 * já saem com `has_template_applied: true`, então o estado `aplicando` não
 * é usado no caminho feliz (reservado só como fallback, hoje sem chamador).
 */
export async function advanceCutProEdit(
  supabase: SupabaseClient,
  table: CutProTable,
  item: CutProEditableRow
): Promise<void> {
  const cutpro = getCutProProvider();

  try {
    if (item.edit_status === "enviando") {
      await stepEnviando(supabase, table, item, cutpro);
      return;
    }
    if (item.edit_status === "clipando") {
      await stepClipando(supabase, table, item, cutpro);
      return;
    }
    if (item.edit_status === "renderizando") {
      await stepRenderizando(supabase, table, item, cutpro);
      return;
    }
  } catch (err) {
    if (err instanceof CutProRateLimitError) {
      // 429 BATCH_ALREADY_RUNNING — não é erro real, só tenta de novo no
      // próximo ciclo do cron (não grava cutpro_error nem muda edit_status).
      console.warn(`[cutpro-pipeline] ${table} ${item.id} — rate limit, retry no próximo ciclo:`, err.message);
      return;
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido no pipeline Cut.Pro.";
    await markError(supabase, table, item.id, item.edit_status, message);
  }
}

async function stepEnviando(
  supabase: SupabaseClient,
  table: CutProTable,
  item: CutProEditableRow,
  cutpro: ReturnType<typeof getCutProProvider>
): Promise<void> {
  if (!item.media_storage_path) {
    await markError(supabase, table, item.id, "enviando", "Item sem mídia no Storage.");
    return;
  }
  if (!item.cutpro_template_id) {
    await markError(supabase, table, item.id, "enviando", "Item sem template Cut.Pro selecionado.");
    return;
  }

  if (item.cutpro_video_id) {
    // Upload já iniciado numa execução anterior (retomável) — só avança.
    const { error } = await supabase
      .from(table)
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

  // Cut.Pro valida a extensão do `file_name` em si (INVALID_FILE_TYPE se
  // não for .mp4/.mov/.webm/.mkv) — o nome original do arquivo (item.filename)
  // não é confiável pra isso (pode vir sem extensão). Usa sempre a extensão
  // real do Storage (media_storage_path) com o nome original como base.
  const cutproFileName = item.filename.toLowerCase().endsWith(`.${extension}`)
    ? item.filename
    : `${item.filename}.${extension}`;

  const upload = await cutpro.startUpload(cutproFileName, mediaBuffer.length, "video/mp4");

  // Upload direto pra URL presignada do Cut.Pro dentro da própria função da
  // Vercel — sem worker externo no meio (decisão de sessão de 16/07/2026,
  // ver PLAN.md: Railway removido do projeto). mediaBuffer já está em
  // memória (baixado acima pro probeVideo), não precisa nem de URL assinada.
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: mediaBuffer,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Cut.Pro recusou o upload do vídeo (status ${uploadResponse.status}).`);
  }

  const completed = await cutpro.completeUpload(
    upload.videoId,
    cutproFileName,
    probe.durationSeconds,
    probe.width,
    probe.height
  );

  if (completed.forceWatermark) {
    await markError(
      supabase,
      table,
      item.id,
      "enviando",
      "O plano Cut.Pro atual gera vídeo com marca d'água (force_watermark=true) — confirme o plano contratado."
    );
    return;
  }

  const { error } = await supabase
    .from(table)
    .update({ cutpro_video_id: upload.videoId, edit_status: "clipando", cutpro_error: null })
    .eq("id", item.id)
    .eq("edit_status", "enviando");
  if (error) console.error("[cutpro-pipeline] falha ao gravar cutpro_video_id:", error);
}

async function stepClipando(
  supabase: SupabaseClient,
  table: CutProTable,
  item: CutProEditableRow,
  cutpro: ReturnType<typeof getCutProProvider>
): Promise<void> {
  if (!item.cutpro_video_id) {
    await markError(supabase, table, item.id, "clipando", "Item sem cutpro_video_id (estado inconsistente).");
    return;
  }

  if (!item.cutpro_submission_id) {
    const submission = await cutpro.submitClipping(item.cutpro_video_id, {
      templateId: item.cutpro_template_id ?? undefined,
    });
    const { error } = await supabase
      .from(table)
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
      table,
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
    await markError(supabase, table, item.id, "clipando", "Clipagem concluída sem nenhum clipe gerado.");
    return;
  }

  const { error } = await supabase
    .from(table)
    .update({ cutpro_clip_id: bestClip.id, edit_status: "renderizando" })
    .eq("id", item.id)
    .eq("edit_status", "clipando");
  if (error) console.error("[cutpro-pipeline] falha ao avançar clipando->renderizando:", error);
}

async function finalizeRender(
  supabase: SupabaseClient,
  table: CutProTable,
  item: CutProEditableRow,
  downloadUrl: string
): Promise<void> {
  // Mesmo raciocínio do upload: baixa direto da CDN do Cut.Pro e sobe pro
  // Storage sem passar por worker externo nenhum.
  const downloadResponse = await fetch(downloadUrl);
  if (!downloadResponse.ok) {
    throw new Error(`Falha ao baixar o render do Cut.Pro (status ${downloadResponse.status}).`);
  }
  const bytes = Buffer.from(await downloadResponse.arrayBuffer());
  const editedPath = `cutpro-edited/${item.id}.mp4`;
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(editedPath, bytes, { contentType: "video/mp4", upsert: true });
  if (uploadError) {
    throw new Error(`Falha ao subir vídeo editado pro Storage: ${uploadError.message}`);
  }

  // `drive_items`: rendered_art_url só é resolvido depois, ao enviar pra
  // aprovação (sendDriveItemToApproval, D5). `posts`: o post já existe e
  // pode já estar visível na fila, então já atualiza rendered_art_url aqui
  // — é o campo que publish-scheduled de fato usa pra publicar
  // (lib/posts/pendingPublish.ts).
  const updatePayload: Record<string, unknown> = {
    edited_media_path: editedPath,
    edit_status: "editado",
    cutpro_error: null,
  };
  if (table === "posts") {
    updatePayload.rendered_art_url = editedPath;
  }

  const { error } = await supabase
    .from(table)
    .update(updatePayload)
    .eq("id", item.id)
    .eq("edit_status", "renderizando");
  if (error) console.error("[cutpro-pipeline] falha ao gravar edited_media_path:", error);
}

async function stepRenderizando(
  supabase: SupabaseClient,
  table: CutProTable,
  item: CutProEditableRow,
  cutpro: ReturnType<typeof getCutProProvider>
): Promise<void> {
  if (!item.cutpro_video_id || !item.cutpro_submission_id || !item.cutpro_clip_id) {
    await markError(supabase, table, item.id, "renderizando", "Item sem clipe escolhido (estado inconsistente).");
    return;
  }

  if (!item.cutpro_render_id) {
    const render = await cutpro.renderClip(item.cutpro_video_id, item.cutpro_submission_id, item.cutpro_clip_id);
    if (render.hasWatermark) {
      await markError(supabase, table, item.id, "renderizando", "Render saiu com marca d'água (has_watermark=true).");
      return;
    }
    // from_cache/status "completed" já vem com download_url pronto — pula
    // direto pro download, sem precisar de outro ciclo de polling.
    if (render.status === "completed" && render.downloadUrl) {
      await finalizeRender(supabase, table, item, render.downloadUrl);
      return;
    }
    const { error } = await supabase
      .from(table)
      .update({ cutpro_render_id: render.renderId })
      .eq("id", item.id)
      .eq("edit_status", "renderizando");
    if (error) console.error("[cutpro-pipeline] falha ao gravar cutpro_render_id:", error);
    return;
  }

  const status = await cutpro.getRenderStatus(item.cutpro_render_id);
  if (status.status === "failed" || status.status === "cancelled" || status.status === "expired") {
    await markError(supabase, table, item.id, "renderizando", `Render terminou com status "${status.status}".`);
    return;
  }
  if (status.status !== "completed") {
    return; // ainda renderizando — tenta de novo no próximo ciclo.
  }

  const { url } = await cutpro.getRenderDownloadUrl(item.cutpro_render_id);
  await finalizeRender(supabase, table, item, url);
}
