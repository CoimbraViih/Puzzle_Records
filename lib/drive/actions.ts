"use server";

import { revalidatePath } from "next/cache";

import { createDriveClient } from "@/lib/drive/client";
import { mirrorFilePair, markRemovedDriveItems } from "@/lib/drive/mirrorFile";
import { listRootFiles } from "@/lib/drive/listPendingFiles";
import { pairFiles } from "@/lib/drive/pairFiles";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Mesma lógica do cron drive-sync (Task 1), disponível como ação manual —
 * "Atualizar agora" não espera o próximo ciclo de 5 min. Roda com
 * service-role (mesmo motivo do cron: baixa/sobe mídia pro Storage sem
 * depender da sessão de quem clicou).
 */
export async function refreshDriveMirror(): Promise<void> {
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) {
    console.error("[drive] GOOGLE_DRIVE_FOLDER_ID não configurado.");
    return;
  }

  let drive;
  try {
    drive = createDriveClient();
  } catch (err) {
    console.error("[drive] falha ao autenticar com o Google Drive:", err);
    return;
  }

  let files;
  try {
    files = await listRootFiles(drive, rootFolderId);
  } catch (err) {
    console.error("[drive] falha ao listar arquivos do Drive:", err);
    return;
  }

  const pairs = pairFiles(files);
  const supabase = createServiceClient();

  for (const pair of pairs) {
    await mirrorFilePair(drive, supabase, pair);
  }
  await markRemovedDriveItems(supabase, pairs.map((pair) => pair.media.id));

  revalidatePath("/drive");
}

/**
 * Dispara a edição via Cut.Pro (M16/D4) — só marca o item pra entrar na
 * máquina de estados do cron `cutpro-pipeline` (5 min, `lib/cutpro/pipeline.ts`),
 * não chama a API do Cut.Pro diretamente (evita fazer trabalho pesado/bytes
 * dentro de uma Server Action da Vercel, mesmo motivo do teto de 60s do
 * Hobby documentado no M11). Único template disponível hoje é o da casa
 * (`CUTPRO_HOUSE_TEMPLATE_ID`, D0) — seletor de múltiplos templates fica
 * pra quando isso virar necessidade real (fora de escopo do M16 atual).
 */
export async function startCutProEdit(driveItemId: string): Promise<{ error?: string }> {
  const templateId = process.env.CUTPRO_HOUSE_TEMPLATE_ID;
  if (!templateId) {
    return { error: "CUTPRO_HOUSE_TEMPLATE_ID não configurado." };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("drive_items")
    .update({ cutpro_template_id: templateId, edit_status: "enviando", cutpro_error: null })
    .eq("id", driveItemId)
    .eq("media_type", "video")
    .in("edit_status", ["nao_editado", "erro"])
    .select("id");

  if (error || !data || data.length === 0) {
    return { error: "Não foi possível iniciar a edição (item já em edição ou inválido)." };
  }

  revalidatePath("/drive");
  return {};
}
