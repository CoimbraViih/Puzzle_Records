import type { SupabaseClient } from "@supabase/supabase-js";
import type { drive_v3 } from "googleapis";

import { InvalidMetadataError, parseMetadata } from "./metadata";
import { resolveSocialAccount } from "./resolveSocialAccount";
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

/**
 * A extensão do nome do arquivo pode estar errada — o mimeType do Drive é
 * quem reflete o conteúdo real (ver isMetadataFile em pairFiles.ts: alguém
 * já renomeou uma mídia real pra "*.json" por engano nesta sessão, e sem
 * essa checagem o objeto salvo no Storage teria ficado com a extensão
 * ".json" apesar de ser um PNG/MP4 de verdade). Cai no nome do arquivo só
 * quando o mimeType não está no mapa acima.
 */
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

async function moveToProcessed(
  drive: drive_v3.Drive,
  fileId: string,
  processedFolderId: string,
  rootFolderId: string
): Promise<void> {
  await drive.files.update({
    fileId,
    addParents: processedFolderId,
    removeParents: rootFolderId,
  });
}

async function recordError(
  supabase: SupabaseClient,
  driveFileId: string,
  message: string
): Promise<void> {
  console.error("Erro na ingestão do Drive:", driveFileId, message);
  await supabase
    .from("drive_ingestions")
    .insert({ drive_file_id: driveFileId, status: "erro", error_message: message });
}

/**
 * Processa um par mídia+metadado: baixa e valida o JSON quando presente
 * (o `.json` é opcional — sem ele, usa o fallback de contexto extraído do
 * nome do arquivo), sobe a mídia pro Storage, resolve artista/conta social,
 * insere o post 'pendente' e move os arquivos originais pra "Processados".
 * Falhas transitórias (download, upload) não são registradas em
 * drive_ingestions — o par continua elegível na próxima execução do cron.
 * Falhas de metadado são registradas como 'erro' (log, não bloqueia retry
 * depois que a equipe corrigir).
 */
export async function ingestFilePair(
  drive: drive_v3.Drive,
  supabase: SupabaseClient,
  pair: FilePair,
  processedFolderId: string,
  rootFolderId: string
): Promise<void> {
  const alreadyProcessed = await supabase
    .from("drive_ingestions")
    .select("id")
    .eq("drive_file_id", pair.media.id)
    .eq("status", "processado")
    .maybeSingle();

  if (alreadyProcessed.data) return;

  const mediaType = mediaTypeFromMimeType(pair.media.mimeType);

  let metadata: { tipo: PostType; fato: string | null; musica: string | null };
  if (pair.metadata) {
    let metadataText: string;
    try {
      const buffer = await downloadFileContent(drive, pair.metadata.id);
      metadataText = buffer.toString("utf-8");
    } catch (err) {
      console.error("Falha ao baixar o metadado do Drive (tenta de novo depois):", err);
      return;
    }

    try {
      metadata = parseMetadata(metadataText, mediaType);
    } catch (err) {
      const message =
        err instanceof InvalidMetadataError ? err.message : "Metadado inválido.";
      await recordError(supabase, pair.media.id, message);
      return;
    }
  } else {
    // Sem .json: tenta extrair contexto do nome do arquivo antes de cair no
    // fallback por tipo de mídia (vídeo se auto-analisa via
    // lib/openai/videoAnalysis.ts quando source_fact é null; imagem sem
    // contexto grava copy_generation_error explícito no cron generate-copy
    // — ver docs/superpowers/specs/2026-07-14-drive-ingestao-sem-json-design.md).
    metadata = {
      tipo: "viral_geral",
      fato: extractContextFromFilename(pair.media.name),
      musica: null,
    };
  }

  let mediaBuffer: Buffer;
  try {
    mediaBuffer = await downloadFileContent(drive, pair.media.id);
  } catch (err) {
    console.error("Falha ao baixar a mídia do Drive (tenta de novo depois):", err);
    return;
  }

  const extension = extensionFromMedia(pair.media);
  const storagePath = `${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("posts-media")
    .upload(storagePath, mediaBuffer, { contentType: pair.media.mimeType });

  if (uploadError) {
    console.error("Falha ao subir a mídia pro Storage (tenta de novo depois):", uploadError);
    return;
  }

  const resolution = await resolveSocialAccount(supabase);

  const { data: post, error: insertError } = await supabase
    .from("posts")
    .insert({
      social_account_id: resolution.socialAccountId,
      post_type: metadata.tipo,
      source_fact: metadata.fato,
      track_name: metadata.musica,
      media_url: storagePath,
      media_type: mediaType,
      status: "pendente",
      ingestion_warning: resolution.warning,
    })
    .select("id")
    .single();

  if (insertError || !post) {
    await recordError(supabase, pair.media.id, "Falha ao criar o post no banco.");
    return;
  }

  const { error: ingestionInsertError } = await supabase
    .from("drive_ingestions")
    .insert({ drive_file_id: pair.media.id, post_id: post.id, status: "processado" });

  if (ingestionInsertError) {
    if (ingestionInsertError.code === "23505") {
      // Índice único parcial de drive_ingestions_file_id_processed_idx
      // (migration 0018) barrou: outra execução do cron já processou
      // esse mesmo arquivo do Drive nesse meio-tempo (janela entre o
      // check "já processado" no início desta função e este insert).
      // Desfaz o post/mídia duplicados que esta execução criou, em vez
      // de deixar os dois.
      console.error(
        "Corrida detectada na ingestão do Drive (outra execução já processou este arquivo) — desfazendo post duplicado:",
        pair.media.id
      );
      await supabase.from("posts").delete().eq("id", post.id);
      await supabase.storage.from("posts-media").remove([storagePath]);
      return;
    }
    console.error(
      "Falha ao registrar drive_ingestions 'processado' (post já existe, risco de duplicar se o move também falhar):",
      ingestionInsertError
    );
  }

  try {
    await moveToProcessed(drive, pair.media.id, processedFolderId, rootFolderId);
    if (pair.metadata) {
      await moveToProcessed(drive, pair.metadata.id, processedFolderId, rootFolderId);
    }
  } catch (err) {
    console.error(
      "Falha ao mover arquivos para 'Processados' após criar o post (post já existe, não crítico):",
      err
    );
  }
}
