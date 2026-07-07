import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/lib/types/post";

export function mediaTypeFromFile(file: File): MediaType {
  return file.type.startsWith("video/") ? "video" : "image";
}

export async function uploadMedia(file: File): Promise<string> {
  const supabase = await createClient();
  const extension = file.name.split(".").pop() ?? "bin";
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("posts-media")
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error("upload_failed");
  }

  return path;
}
