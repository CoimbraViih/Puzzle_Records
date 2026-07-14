/**
 * Tenta extrair contexto legível do nome de um arquivo (sem a extensão) —
 * usado quando não há `.json` de metadado (ingestão do Drive) nem contexto
 * digitado (upload direto no painel). Muitos arquivos gerados por IA
 * generativa já têm nomes descritivos (o próprio prompt usado pra gerar a
 * imagem/vídeo), enquanto nomes de câmera/ferramenta de geração costumam
 * misturar poucas palavras reais com um hash/ID longo — ver
 * docs/superpowers/specs/2026-07-14-drive-ingestao-sem-json-design.md.
 */

const HASH_LIKE_MIN_LENGTH = 12;
const DESCRIPTIVE_MIN_WORDS = 3;
const DESCRIPTIVE_MIN_WORD_LENGTH = 3;

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
}

function tokenize(baseName: string): string[] {
  return baseName.split(/[\s_\-.]+/).filter((token) => token.length > 0);
}

/** Token "tipo hash": comprido, alfanumérico, misturando letra e dígito. */
function looksLikeHash(token: string): boolean {
  if (token.length < HASH_LIKE_MIN_LENGTH) return false;
  const hasLetter = /[a-zA-Z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  const isAlnumOnly = /^[a-zA-Z0-9]+$/.test(token);
  return isAlnumOnly && hasLetter && hasDigit;
}

/** Token "palavra real": só letras (aceita acentos), tamanho mínimo. */
function isAlphabeticWord(token: string): boolean {
  return (
    token.length >= DESCRIPTIVE_MIN_WORD_LENGTH &&
    /^[a-zA-ZÀ-ÖØ-öø-ÿ]+$/.test(token)
  );
}

export function extractContextFromFilename(fileName: string): string | null {
  const base = stripExtension(fileName);
  const tokens = tokenize(base);

  if (tokens.some(looksLikeHash)) {
    return null;
  }

  const alphabeticWords = tokens.filter(isAlphabeticWord);
  if (alphabeticWords.length < DESCRIPTIVE_MIN_WORDS) {
    return null;
  }

  return tokens.join(" ").trim();
}
