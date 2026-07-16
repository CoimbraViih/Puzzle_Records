import { createClient } from "@/lib/supabase/server";

export interface DriveItemRow {
  id: string;
  drive_file_id: string;
  filename: string;
  media_type: "image" | "video";
  media_storage_path: string | null;
  removed_from_drive: boolean;
  post_type: "viral_geral" | "noticia_funk" | "lancamento";
  source_fact: string | null;
  track_name: string | null;
  caption: string | null;
  caption_variations: { headline: string; caption: string }[] | null;
  caption_error: string | null;
  edit_status:
    | "nao_editado"
    | "enviando"
    | "clipando"
    | "aplicando"
    | "renderizando"
    | "editado"
    | "erro";
  cutpro_template_id: string | null;
  cutpro_error: string | null;
  edited_media_path: string | null;
  post_id: string | null;
  created_at: string;
}

/** Ordenado por criação mais recente primeiro, mesmo padrão de listPostsPendingPublish. */
export async function listDriveItems(): Promise<DriveItemRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drive_items")
    .select(
      "id, drive_file_id, filename, media_type, media_storage_path, removed_from_drive, post_type, source_fact, track_name, caption, caption_variations, caption_error, edit_status, cutpro_template_id, cutpro_error, edited_media_path, post_id, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[drive] falha ao listar drive_items:", error.message);
    return [];
  }
  return data ?? [];
}
