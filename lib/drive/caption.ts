"use server";

import { revalidatePath } from "next/cache";

import { generateCopyVariations, CopyGenerationError } from "@/lib/openai/generateCopy";
import { createClient } from "@/lib/supabase/server";
import type { CopyVariation } from "@/lib/types/post";

/**
 * Gera 2-3 variações de legenda pro item — mesma pipeline usada por
 * createPostWithAI (lib/posts/actions.ts) e pelo cron generate-copy: vídeo
 * usa a análise multimodal (frames+Whisper via generateCopyVariations mode
 * "video"), imagem usa o contexto (source_fact do .json/nome de arquivo,
 * mesmo fallback já resolvido no mirror da Task 1).
 */
export async function generateDriveItemCaption(
  driveItemId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from("drive_items")
    .select("id, media_storage_path, media_type, post_type, source_fact, track_name, filename")
    .eq("id", driveItemId)
    .maybeSingle();

  if (fetchError || !item || !item.media_storage_path) {
    return { error: "Item do Drive não encontrado ou sem mídia baixada ainda." };
  }

  if (item.media_type === "image" && !item.source_fact) {
    await supabase
      .from("drive_items")
      .update({ caption_error: "Sem contexto para a IA — edite o fato antes de gerar a legenda." })
      .eq("id", driveItemId);
    revalidatePath("/drive");
    return { error: "Sem contexto para a IA — edite o fato antes de gerar a legenda." };
  }

  let variations: CopyVariation[];
  try {
    if (item.media_type === "video") {
      const { data: mediaBlob, error: downloadError } = await supabase.storage
        .from("posts-media")
        .download(item.media_storage_path);
      if (downloadError || !mediaBlob) {
        throw new CopyGenerationError("Falha ao baixar o vídeo do Storage para análise.");
      }
      const videoBuffer = Buffer.from(await mediaBlob.arrayBuffer());
      variations = await generateCopyVariations({
        mode: "video",
        postType: item.post_type,
        trackName: item.track_name,
        additionalContext: item.source_fact,
        videoBuffer,
        filename: item.filename,
      });
    } else {
      variations = await generateCopyVariations({
        mode: "text",
        postType: item.post_type,
        fact: item.source_fact as string,
        trackName: item.track_name,
      });
    }
  } catch (err) {
    const message =
      err instanceof CopyGenerationError
        ? err.message
        : "A IA não conseguiu gerar a legenda. Tente novamente.";
    console.error("[drive] falha ao gerar legenda:", driveItemId, err);
    await supabase.from("drive_items").update({ caption_error: message }).eq("id", driveItemId);
    revalidatePath("/drive");
    return { error: message };
  }

  await supabase
    .from("drive_items")
    .update({
      caption: variations[0].caption,
      caption_variations: variations,
      caption_error: null,
    })
    .eq("id", driveItemId);

  revalidatePath("/drive");
  return {};
}

/** Troca a legenda ativa pra uma das variações já geradas (picker no card, mesmo padrão do Kanban). */
export async function selectDriveItemCaption(driveItemId: string, index: number): Promise<void> {
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("drive_items")
    .select("caption_variations")
    .eq("id", driveItemId)
    .maybeSingle();

  const variations = (item?.caption_variations ?? []) as CopyVariation[];
  const chosen = variations[index];
  if (!chosen) return;

  await supabase.from("drive_items").update({ caption: chosen.caption }).eq("id", driveItemId);
  revalidatePath("/drive");
}
