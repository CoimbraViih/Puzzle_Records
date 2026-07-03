import type { drive_v3 } from "googleapis";

const PROCESSED_FOLDER_NAME = "Processados";

/**
 * Acha (ou cria, na primeira execução) a subpasta "Processados" dentro da
 * pasta raiz de ingestão. Arquivos movidos pra lá saem da listagem de
 * `listRootFiles` e ficam disponíveis como histórico/auditoria visual.
 */
export async function findOrCreateProcessedFolder(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<string> {
  const existing = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${PROCESSED_FOLDER_NAME}' and trashed = false`,
    fields: "files(id, name)",
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name: PROCESSED_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error("Falha ao criar a subpasta 'Processados' no Drive.");
  }

  return created.data.id;
}
