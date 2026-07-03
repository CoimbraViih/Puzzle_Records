export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface FilePair {
  baseName: string;
  media: DriveFile;
  metadata: DriveFile;
}

function baseName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
}

function isMetadataFile(file: DriveFile): boolean {
  return file.name.toLowerCase().endsWith(".json");
}

/**
 * Agrupa arquivos por nome-base e retorna só os pares completos (1 mídia +
 * 1 .json). Arquivos sem par ainda (só a mídia ou só o json soltos) são
 * ignorados — ficam pra próxima execução do cron, quando o par completar.
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
    if (group.media && group.metadata) {
      pairs.push({ baseName: name, media: group.media, metadata: group.metadata });
    }
  }
  return pairs;
}
