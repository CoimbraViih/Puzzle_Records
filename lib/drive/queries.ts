import { createClient } from "@/lib/supabase/server";

export interface DriveItemRow {
  id: string;
  drive_file_id: string;
  filename: string;
  media_type: "image" | "video";
  media_storage_path: string | null;
  mirror_error: string | null;
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
  /** Progresso real (0-100) do render Cut.Pro (migration 0030) — null antes
   * da migration ser aplicada em produção ou fora do estado "renderizando". */
  cutpro_render_progress: number | null;
  edited_media_path: string | null;
  post_id: string | null;
  created_at: string;
  /** Usado por RenderStatusBadge (components/drive/render-status-badge.tsx)
   * pra calcular o tempo decorrido desde a última mudança de edit_status. */
  updated_at: string;
  /** URL assinada (1h) do media_storage_path — null se ainda não baixado. */
  media_signed_url: string | null;
  /** URL assinada (1h) do edited_media_path — null se o item não foi editado no Cut.Pro. */
  edited_media_signed_url: string | null;
}

/** Ordenado por criação mais recente primeiro, mesmo padrão de listPostsPendingPublish. */
export async function listDriveItems(): Promise<DriveItemRow[]> {
  const supabase = await createClient();
  // select("*") em vez de uma lista explícita de colunas (mesmo padrão de
  // listPosts, lib/posts/queries.ts) — de propósito: um select explícito
  // referenciando cutpro_render_progress quebraria essa query inteira (e
  // /drive inteiro junto) enquanto a migration 0030 não for aplicada em
  // produção; com "*", a coluna nova só fica undefined até lá, sem
  // derrubar o resto da página (achado da revisão final de branch).
  const { data, error } = await supabase
    .from("drive_items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[drive] falha ao listar drive_items:", error.message);
    return [];
  }

  const items = data ?? [];
  if (items.length === 0) return items.map((item) => ({ ...item, media_signed_url: null, edited_media_signed_url: null }));

  // Mesmo padrão de listPosts (lib/posts/queries.ts): 1 round-trip só pro
  // Storage, misturando os paths de mídia original e de mídia editada.
  const mediaPaths = items.map((item) => item.media_storage_path);
  const editedPathEntries = items
    .map((item, index) => ({ index, path: item.edited_media_path }))
    .filter((entry): entry is { index: number; path: string } => entry.path !== null);

  const { data: signedUrls, error: signedUrlsError } = await supabase.storage
    .from("posts-media")
    .createSignedUrls(
      [...mediaPaths.filter((p): p is string => p !== null), ...editedPathEntries.map((entry) => entry.path)],
      60 * 60
    );

  if (signedUrlsError) {
    console.error("[drive] falha ao gerar URLs assinadas da mídia:", signedUrlsError.message);
    return items.map((item) => ({ ...item, media_signed_url: null, edited_media_signed_url: null }));
  }

  // mediaPaths pode ter nulls (item sem mídia baixada ainda) — mapeia por
  // posição pulando os nulls, já que createSignedUrls só recebeu os paths reais.
  let mediaCursor = 0;
  const mediaSignedUrlByIndex = new Map<number, string | null>();
  mediaPaths.forEach((path, index) => {
    if (path === null) {
      mediaSignedUrlByIndex.set(index, null);
      return;
    }
    mediaSignedUrlByIndex.set(index, signedUrls?.[mediaCursor]?.signedUrl ?? null);
    mediaCursor++;
  });

  const editedSignedUrlByIndex = new Map<number, string | null>();
  editedPathEntries.forEach((entry, editedIndex) => {
    editedSignedUrlByIndex.set(entry.index, signedUrls?.[mediaCursor + editedIndex]?.signedUrl ?? null);
  });

  return items.map((item, index) => ({
    ...item,
    media_signed_url: mediaSignedUrlByIndex.get(index) ?? null,
    edited_media_signed_url: editedSignedUrlByIndex.get(index) ?? null,
  }));
}
