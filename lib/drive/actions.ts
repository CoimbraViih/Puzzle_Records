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
