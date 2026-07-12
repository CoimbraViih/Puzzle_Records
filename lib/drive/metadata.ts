import { POST_TYPES, type PostType } from "@/lib/types/post";

export interface DriveMetadata {
  musica: string | null;
  fato: string | null;
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
 * { "musica": "...", "fato": "...", "tipo": "lancamento" }
 * `musica` é sempre opcional. `fato` é obrigatório só para imagem — para
 * vídeo, a IA analisa o próprio conteúdo quando `fato` está ausente (ver
 * lib/openai/videoAnalysis.ts), mas um `fato` presente ainda é aproveitado
 * como contexto adicional.
 */
export function parseMetadata(
  raw: string,
  mediaType: "image" | "video"
): DriveMetadata {
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
  const tipo = typeof data.tipo === "string" ? data.tipo : "";

  if (!fato && mediaType === "image") {
    throw new InvalidMetadataError(
      "Campo 'fato' é obrigatório para imagem (vídeo pode omitir — a IA analisa o conteúdo)."
    );
  }
  if (!POST_TYPES.includes(tipo as PostType)) {
    throw new InvalidMetadataError(
      `Campo 'tipo' inválido: "${tipo}". Esperado um de: ${POST_TYPES.join(", ")}.`
    );
  }

  return {
    musica: readOptionalString(data.musica),
    fato,
    tipo: tipo as PostType,
  };
}
