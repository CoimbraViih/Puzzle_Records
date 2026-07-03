import type { drive_v3 } from "googleapis";

import type { DriveFile } from "./pairFiles";

/**
 * Lista os arquivos que estão diretamente na pasta raiz (não em
 * subpastas). Arquivos já movidos para "Processados" somem dessa lista
 * naturalmente, porque o parent deles muda quando são movidos — não
 * precisa filtrar isso explicitamente.
 */
export async function listRootFiles(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<DriveFile[]> {
  const response = await drive.files.list({
    q: `'${rootFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, mimeType)",
    pageSize: 100,
  });

  return (response.data.files ?? [])
    .filter((file) => file.id && file.name && file.mimeType)
    .map((file) => ({
      id: file.id as string,
      name: file.name as string,
      mimeType: file.mimeType as string,
    }));
}
