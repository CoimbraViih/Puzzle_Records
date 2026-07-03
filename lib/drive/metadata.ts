import { POST_TYPES, type PostType } from "@/lib/types/post";

export interface DriveMetadata {
  artista: string | null;
  musica: string | null;
  fato: string;
  contaSocial: string;
  tipo: PostType;
}

export class InvalidMetadataError extends Error {}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Espera um JSON no formato:
 * { "artista": "...", "musica": "...", "fato": "...",
 *   "conta_social": "...", "tipo": "lancamento" }
 * `artista` e `musica` são opcionais; os demais são obrigatórios.
 */
export function parseMetadata(raw: string): DriveMetadata {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InvalidMetadataError("JSON inválido.");
  }

  if (typeof json !== "object" || json === null) {
    throw new InvalidMetadataError("Metadado precisa ser um objeto JSON.");
  }

  const data = json as Record<string, unknown>;
  const fato = readOptionalString(data.fato);
  const contaSocial = readOptionalString(data.conta_social);
  const tipo = typeof data.tipo === "string" ? data.tipo : "";

  if (!fato) throw new InvalidMetadataError("Campo 'fato' é obrigatório.");
  if (!contaSocial) {
    throw new InvalidMetadataError("Campo 'conta_social' é obrigatório.");
  }
  if (!POST_TYPES.includes(tipo as PostType)) {
    throw new InvalidMetadataError(
      `Campo 'tipo' inválido: "${tipo}". Esperado um de: ${POST_TYPES.join(", ")}.`
    );
  }

  return {
    artista: readOptionalString(data.artista),
    musica: readOptionalString(data.musica),
    fato,
    contaSocial,
    tipo: tipo as PostType,
  };
}
