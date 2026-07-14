import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/lib/types/post";

export function mediaTypeFromFile(file: File): MediaType {
  return file.type.startsWith("video/") ? "video" : "image";
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
 * A extensão do nome do arquivo pode não bater com o conteúdo real (o
 * usuário renomeou, ou o SO não anexou nenhuma) — `file.type` (mimeType)
 * reflete o conteúdo de verdade, mesmo padrão de defesa já usado na
 * ingestão do Drive (lib/drive/ingestFile.ts).
 */
function extensionFromFile(file: File): string {
  return EXTENSION_BY_MIME_TYPE[file.type] ?? file.name.split(".").pop() ?? "bin";
}

export async function uploadMedia(file: File): Promise<string> {
  const supabase = await createClient();
  const extension = extensionFromFile(file);
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("posts-media")
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error("upload_failed");
  }

  return path;
}
