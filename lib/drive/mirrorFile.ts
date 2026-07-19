import type { SupabaseClient } from "@supabase/supabase-js";
import type { drive_v3 } from "googleapis";

import { InvalidMetadataError, parseMetadata } from "./metadata";
import { extractContextFromFilename } from "./filenameContext";
import type { FilePair } from "./pairFiles";
import type { PostType } from "@/lib/types/post";

function mediaTypeFromMimeType(mimeType: string): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

function extensionFromMedia(file: { name: string; mimeType: string }): string {
  return (
    EXTENSION_BY_MIME_TYPE[file.mimeType] ?? file.name.split(".").pop() ?? "bin"
  );
}

async function downloadFileContent(
  drive: drive_v3.Drive,
  fileId: string
): Promise<Buffer> {
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data as ArrayBuffer);
}

/**
 * Espelha um par mídia+metadado em drive_items (upsert por drive_file_id).
 * Nunca cria post — isso agora é ação manual "Enviar para aprovação"
 * (Task 4). Diferente do antigo ingestFilePair (M3), não move nada pra
 * "Processados": a pasta é a fonte viva do espelho, drive-sync roda de
 * novo a cada 5 min e reconcilia com markRemovedDriveItems.
 */
export async function mirrorFilePair(
  drive: drive_v3.Drive,
  supabase: SupabaseClient,
  pair: FilePair
): Promise<void> {
  const existing = await supabase
    .from("drive_items")
    .select("id, media_storage_path")
    .eq("drive_file_id", pair.media.id)
    .maybeSingle();

  // Já espelhado com mídia baixada: só garante removed_from_drive=false
  // (o item voltou a aparecer na listagem) e retorna — não reprocessa
  // legenda/edição já em andamento.
  if (existing.data?.media_storage_path) {
    await supabase
      .from("drive_items")
      .update({ removed_from_drive: false })
      .eq("id", existing.data.id);
    return;
  }

  const mediaType = mediaTypeFromMimeType(pair.media.mimeType);

  // Upsert "placeholder" logo de cara (sem media_storage_path ainda) —
  // garante que o item aparece em /drive mesmo se o download/upload
  // falhar mais abaixo, em vez de nunca criar linha nenhuma e ficar
  // invisível sem nenhum sinal (achado real em produção: vídeo maior que
  // o limite do bucket, ver migration 0026).
  async function recordMirrorError(message: string): Promise<void> {
    console.error("[drive-sync]", message, pair.media.id);
    await supabase.from("drive_items").upsert(
      {
        drive_file_id: pair.media.id,
        drive_metadata_file_id: pair.metadata?.id ?? null,
        filename: pair.media.name,
        media_type: mediaType,
        removed_from_drive: false,
        mirror_error: message,
      },
      { onConflict: "drive_file_id" }
    );
  }

  let context: { post_type: PostType; source_fact: string | null; track_name: string | null };
  if (pair.metadata) {
    let metadataText: string;
    try {
      const buffer = await downloadFileContent(drive, pair.metadata.id);
      metadataText = buffer.toString("utf-8");
    } catch (err) {
      await recordMirrorError(
        `Falha ao baixar metadado do Drive (tenta de novo no próximo ciclo): ${
          err instanceof Error ? err.message : "erro desconhecido"
        }`
      );
      return;
    }
    try {
      const parsed = parseMetadata(metadataText, mediaType);
      context = { post_type: parsed.tipo, source_fact: parsed.fato, track_name: parsed.musica };
    } catch (err) {
      const message =
        err instanceof InvalidMetadataError ? err.message : "Metadado inválido.";
      console.error("[drive-sync] metadado inválido, espelhando sem contexto:", pair.media.id, message);
      context = { post_type: "viral_geral", source_fact: null, track_name: null };
    }
  } else {
    context = {
      post_type: "viral_geral",
      source_fact: extractContextFromFilename(pair.media.name),
      track_name: null,
    };
  }

  let mediaBuffer: Buffer;
  try {
    mediaBuffer = await downloadFileContent(drive, pair.media.id);
  } catch (err) {
    await recordMirrorError(
      `Falha ao baixar mídia do Drive (tenta de novo no próximo ciclo): ${
        err instanceof Error ? err.message : "erro desconhecido"
      }`
    );
    return;
  }

  const extension = extensionFromMedia(pair.media);
  const storagePath = `${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("posts-media")
    .upload(storagePath, mediaBuffer, { contentType: pair.media.mimeType });

  if (uploadError) {
    await recordMirrorError(`Falha ao subir mídia pro Storage: ${uploadError.message}`);
    return;
  }

  const { error: upsertError } = await supabase.from("drive_items").upsert(
    {
      drive_file_id: pair.media.id,
      drive_metadata_file_id: pair.metadata?.id ?? null,
      filename: pair.media.name,
      media_type: mediaType,
      media_storage_path: storagePath,
      removed_from_drive: false,
      post_type: context.post_type,
      source_fact: context.source_fact,
      track_name: context.track_name,
      mirror_error: null,
    },
    { onConflict: "drive_file_id" }
  );

  if (upsertError) {
    console.error("[drive-sync] falha ao gravar drive_items (mídia órfã no Storage):", upsertError);
    await supabase.storage.from("posts-media").remove([storagePath]);
  }
}

/**
 * Arquivo que sumiu da pasta desde o último ciclo: se nunca virou post,
 * remove a linha (nunca fez parte de nenhum histórico visível fora do
 * espelho); se já tem post_id, marca removed_from_drive em vez de apagar
 * (preserva o rastro do que foi enviado à fila).
 */
export async function markRemovedDriveItems(
  supabase: SupabaseClient,
  currentDriveFileIds: string[]
): Promise<void> {
  let query = supabase.from("drive_items").select("id, post_id").eq("removed_from_drive", false);

  // Guarda contra a lista vazia: `.not("drive_file_id", "in", "()")` é SQL
  // inválido (lista vazia dentro de IN/NOT IN não é aceita pelo PostgREST) e
  // `.not(..., "in", '("")')` casaria só a string vazia, deixando de marcar
  // itens que de fato sumiram quando a pasta fica sem nenhum arquivo. Sem
  // filtro nenhum, a query já traz todas as linhas com removed_from_drive
  // false — exatamente o que queremos marcar/apagar quando não sobrou
  // nenhum arquivo na pasta.
  if (currentDriveFileIds.length > 0) {
    const idList = currentDriveFileIds.map((id) => `"${id}"`).join(",");
    query = query.not("drive_file_id", "in", `(${idList})`);
  }

  const { data: stale, error } = await query;

  if (error) {
    console.error("[drive-sync] falha ao buscar itens removidos do Drive:", error.message);
    return;
  }

  for (const item of stale ?? []) {
    if (item.post_id) {
      await supabase.from("drive_items").update({ removed_from_drive: true }).eq("id", item.id);
    } else {
      await supabase.from("drive_items").delete().eq("id", item.id);
    }
  }
}
