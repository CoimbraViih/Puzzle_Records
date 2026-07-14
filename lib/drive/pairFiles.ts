export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface FilePair {
  baseName: string;
  media: DriveFile;
  metadata?: DriveFile;
}

function baseName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
}

function isMetadataFile(file: DriveFile): boolean {
  return file.name.toLowerCase().endsWith(".json");
}

/**
 * Agrupa arquivos por nome-base. Mídia sozinha (sem `.json`) já é um item
 * válido — `metadata` fica `undefined` e quem consome decide o fallback (ver
 * `ingestFile.ts`). Um `.json` órfão, sem mídia com o mesmo nome, continua sem
 * sentido e é ignorado.
 */
export function pairFiles(files: DriveFile[]): FilePair[] {
  const groups = new Map<string, { media?: DriveFile; metadata?: DriveFile }>();

  for (const file of files) {
    const key = baseName(file.name);
    const group = groups.get(key) ?? {};
    if (isMetadataFile(file)) {
      group.metadata = file;
    } else {
      group.media = file;
    }
    groups.set(key, group);
  }

  const pairs: FilePair[] = [];
  for (const [name, group] of groups) {
    if (group.media) {
      pairs.push({ baseName: name, media: group.media, metadata: group.metadata });
    }
  }
  return pairs;
}
