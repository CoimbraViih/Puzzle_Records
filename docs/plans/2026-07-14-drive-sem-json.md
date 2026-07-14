# Drive sem `.json` obrigatório + contexto por nome de arquivo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deixar a ingestão do Google Drive funcionar com uma mídia sozinha (sem `.json`
pareado), extraindo contexto do próprio nome do arquivo quando ele for descritivo —
mesma heurística aplicada também ao "Post rápido" do painel.

**Architecture:** `lib/drive/pairFiles.ts` deixa de exigir os dois arquivos (metadata
vira opcional no tipo `FilePair`); uma função pura nova (`lib/drive/filenameContext.ts`)
decide se o nome do arquivo é "descritivo" o bastante pra virar contexto; `ingestFile.ts`
e `createPostWithAI` (upload direto no painel) usam essa função como fallback antes de
cair no comportamento por tipo de mídia que já existe hoje (vídeo sempre se auto-analisa;
imagem sem contexto grava erro explícito, sem custo de IA). Nenhuma mudança em
`generateCopy.ts`/`prompts.ts`/no cron `generate-copy` — os modos que já existem cobrem
tudo, só muda o que alimenta `source_fact` antes deles rodarem.

**Tech Stack:** TypeScript puro (sem framework de teste no repo — verificação manual via
`node`/`tsx`, mesmo padrão de `lib/acervo/scheduler.ts`/`lib/calendar/month.ts`).

**Spec de referência:** `docs/superpowers/specs/2026-07-14-drive-ingestao-sem-json-design.md`

---

### Task 1: `lib/drive/filenameContext.ts` — heurística de nome descritivo

**Files:**
- Create: `lib/drive/filenameContext.ts`

**Step 1: Implementar a função**

```ts
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
```

**Step 2: Verificar manualmente com um script node (sem framework de teste no repo)**

Crie um arquivo temporário `/tmp/check-filename-context.mjs` (fora do repo, não commitar)
com este conteúdo, ajustando o caminho de import pro compilado ou rodando via `tsx`:

```bash
npx tsx -e '
import { extractContextFromFilename } from "./lib/drive/filenameContext";

const cases = [
  ["Crie uma imagem de um cachorro em um gramado.png", "crie uma imagem de um cachorro em um gramado"],
  ["20251022_2126_New Video_simple_compose_01k877bc1mfm59en0zkzg7ph8g.mp4", null],
  ["IMG_2051.png", null],
  ["video.mp4", null],
  ["Anitta anuncia nova música.png", "anitta anuncia nova música"],
  ["a.png", null],
]

for (const [input, expected] of cases) {
  const got = extractContextFromFilename(input);
  const gotNormalized = got === null ? null : got.toLowerCase();
  const pass = gotNormalized === expected;
  console.log(pass ? "PASS" : "FAIL", JSON.stringify(input), "=>", JSON.stringify(got));
}
'
```

Expected: todas as 6 linhas impressas como `PASS`. Se `IMG_2051.png` não der `FAIL`
inesperado: `IMG` (3 letras) e `2051` (dígitos, não alfabético) — só 1 token
alfabético (`IMG`), abaixo do mínimo de 3 → `null`, correto.

**Step 3: Commit**

```bash
git add lib/drive/filenameContext.ts
git commit -m "feat(drive): heuristica de nome de arquivo descritivo"
```

---

### Task 2: `lib/drive/pairFiles.ts` — metadata vira opcional

**Files:**
- Modify: `lib/drive/pairFiles.ts`

**Step 1: Ler o arquivo atual**

Confirme que bate com o conteúdo mostrado no brief antes de editar (12 primeiras linhas
declaram `FilePair` com `metadata: DriveFile` obrigatório; a função `pairFiles` só
inclui no resultado grupos com `group.media && group.metadata`).

**Step 2: Editar**

Trocar:
```ts
export interface FilePair {
  baseName: string;
  media: DriveFile;
  metadata: DriveFile;
}
```
por:
```ts
export interface FilePair {
  baseName: string;
  media: DriveFile;
  metadata?: DriveFile;
}
```

E trocar o corpo de `pairFiles`:
```ts
  const pairs: FilePair[] = [];
  for (const [name, group] of groups) {
    if (group.media && group.metadata) {
      pairs.push({ baseName: name, media: group.media, metadata: group.metadata });
    }
  }
  return pairs;
```
por:
```ts
  const pairs: FilePair[] = [];
  for (const [name, group] of groups) {
    if (group.media) {
      pairs.push({ baseName: name, media: group.media, metadata: group.metadata });
    }
  }
  return pairs;
```

Atualizar o comentário da função (linhas 22-25) — a frase "Arquivos sem par ainda (só a
mídia ou só o json soltos) são ignorados" não é mais verdade pra mídia sozinha. Trocar
por algo como: "Agrupa arquivos por nome-base. Mídia sozinha (sem `.json`) já é um item
válido — `metadata` fica `undefined` e quem consome decide o fallback (ver
`ingestFile.ts`). Um `.json` órfão, sem mídia com o mesmo nome, continua sem sentido e é
ignorado."

**Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: erros em `lib/drive/ingestFile.ts` (linha que acessa `pair.metadata.id` sem
checar undefined primeiro) — **esperado nesta task**, a Task 3 corrige. Se aparecer
qualquer outro erro não relacionado a `pair.metadata`, pare e investigue antes de
continuar.

**Step 4: Commit**

```bash
git add lib/drive/pairFiles.ts
git commit -m "feat(drive): metadata vira opcional em FilePair"
```

---

### Task 3: `lib/drive/ingestFile.ts` — usar contexto do nome quando não há metadata

**Files:**
- Modify: `lib/drive/ingestFile.ts`

**Step 1: Ler o arquivo atual**

Note a estrutura de `ingestFilePair`: baixa+parseia o metadado (linhas 71-90), depois
baixa a mídia, sobe pro Storage, resolve a conta social, insere o post usando
`metadata.tipo`/`metadata.fato`/`metadata.musica`, grava `drive_ingestions`, move os 2
arquivos originais (mídia + metadado) pra "Processados".

**Step 2: Editar — import novo**

No topo do arquivo, adicionar:
```ts
import { extractContextFromFilename } from "./filenameContext";
```

**Step 3: Editar — bloco de leitura do metadado**

Trocar o bloco (linhas 71-90 do arquivo atual):
```ts
  let metadataText: string;
  try {
    const buffer = await downloadFileContent(drive, pair.metadata.id);
    metadataText = buffer.toString("utf-8");
  } catch (err) {
    console.error("Falha ao baixar o metadado do Drive (tenta de novo depois):", err);
    return;
  }

  const mediaType = mediaTypeFromMimeType(pair.media.mimeType);

  let metadata;
  try {
    metadata = parseMetadata(metadataText, mediaType);
  } catch (err) {
    const message =
      err instanceof InvalidMetadataError ? err.message : "Metadado inválido.";
    await recordError(supabase, pair.media.id, message);
    return;
  }
```
por:
```ts
  const mediaType = mediaTypeFromMimeType(pair.media.mimeType);

  let metadata: { tipo: PostType; fato: string | null; musica: string | null };
  if (pair.metadata) {
    let metadataText: string;
    try {
      const buffer = await downloadFileContent(drive, pair.metadata.id);
      metadataText = buffer.toString("utf-8");
    } catch (err) {
      console.error("Falha ao baixar o metadado do Drive (tenta de novo depois):", err);
      return;
    }

    try {
      metadata = parseMetadata(metadataText, mediaType);
    } catch (err) {
      const message =
        err instanceof InvalidMetadataError ? err.message : "Metadado inválido.";
      await recordError(supabase, pair.media.id, message);
      return;
    }
  } else {
    // Sem .json: tenta extrair contexto do nome do arquivo antes de cair no
    // fallback por tipo de mídia (vídeo se auto-analisa via
    // lib/openai/videoAnalysis.ts quando source_fact é null; imagem sem
    // contexto grava copy_generation_error explícito no cron generate-copy
    // — ver docs/superpowers/specs/2026-07-14-drive-ingestao-sem-json-design.md).
    metadata = {
      tipo: "viral_geral",
      fato: extractContextFromFilename(pair.media.name),
      musica: null,
    };
  }
```

Adicionar `import type { PostType } from "@/lib/types/post";` no topo do arquivo (usado
na anotação de tipo de `metadata` acima).

**Step 4: Editar — mover só os arquivos que existem**

No final da função, trocar:
```ts
  try {
    await moveToProcessed(drive, pair.media.id, processedFolderId, rootFolderId);
    await moveToProcessed(drive, pair.metadata.id, processedFolderId, rootFolderId);
  } catch (err) {
```
por:
```ts
  try {
    await moveToProcessed(drive, pair.media.id, processedFolderId, rootFolderId);
    if (pair.metadata) {
      await moveToProcessed(drive, pair.metadata.id, processedFolderId, rootFolderId);
    }
  } catch (err) {
```

**Step 5: Atualizar o comentário da função**

O comentário JSDoc de `ingestFilePair` (linhas 47-54) menciona "baixa e valida o JSON"
como se fosse sempre obrigatório — ajustar pra deixar claro que o `.json` agora é
opcional e o fallback é o nome do arquivo.

**Step 6: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (a Task 2 tinha deixado erros aqui de propósito; devem sumir agora).

**Step 7: Commit**

```bash
git add lib/drive/ingestFile.ts
git commit -m "feat(drive): usa contexto do nome do arquivo quando nao ha .json"
```

---

### Task 4: `lib/posts/actions.ts` — mesma heurística no "Post rápido"

**Files:**
- Modify: `lib/posts/actions.ts`

**Step 1: Ler a função atual**

Em `createPostWithAI` (por volta da linha 115), o campo `context` vem direto do
formulário (linha 130: `String(formData.get("context") ?? "").trim()`), e a validação
atual (linha 143-145) rejeita imagem sem `context`.

**Step 2: Editar — import novo**

Adicionar, junto aos outros imports de `lib/drive`:
```ts
import { extractContextFromFilename } from "@/lib/drive/filenameContext";
```

**Step 3: Editar — aplicar a heurística antes da validação**

Trocar:
```ts
  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const postType = String(formData.get("post_type") ?? "") as PostType;
  const templateRaw = String(formData.get("template") ?? "");
  const context = String(formData.get("context") ?? "").trim();

  if (!socialAccountId || !postType) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  const mediaType = mediaTypeFromFile(mediaFile);

  if (mediaType === "image" && !context) {
    return { error: "Digite o contexto da imagem para a IA escrever a legenda." };
  }
```
por:
```ts
  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const postType = String(formData.get("post_type") ?? "") as PostType;
  const templateRaw = String(formData.get("template") ?? "");
  const typedContext = String(formData.get("context") ?? "").trim();

  if (!socialAccountId || !postType) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  const mediaType = mediaTypeFromFile(mediaFile);

  // Sem contexto digitado: tenta extrair do nome do arquivo antes de cair
  // no fallback por tipo de mídia (mesma heurística da ingestão do Drive —
  // ver docs/superpowers/specs/2026-07-14-drive-ingestao-sem-json-design.md).
  const context = typedContext || extractContextFromFilename(mediaFile.name) || "";

  if (mediaType === "image" && !context) {
    return { error: "Digite o contexto da imagem para a IA escrever a legenda." };
  }
```

Note que o resto da função já usa a variável `context` (linhas 171, 178) sem mudança —
o `mode: "video"` já trata `context || null` como opcional (linha 171), e `mode: "text"`
(imagem) já usa `context` como `fact` (linha 178) — ambos continuam funcionando sem
alteração adicional, agora só recebendo um valor preenchido com mais frequência.

**Step 4: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros novos (só os 8 warnings pré-existentes de `<img>`/`alt` em
`lib/renderer/templates/*`).

**Step 5: Commit**

```bash
git add lib/posts/actions.ts
git commit -m "feat(posts): aplica heuristica de nome de arquivo no Post rapido"
```

---

### Task 5: Verificação final + PLAN.md

**Files:** nenhum novo além de `PLAN.md`.

**Step 1: Build completo**

Run: `npm run build`
Expected: `✓ Compiled successfully`, sem erros de TypeScript.

**Step 2: Typecheck e lint isolados**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 erros; só os 8 warnings pré-existentes de `<img>`/`alt`.

**Step 3: Reconferir a heurística com os 2 arquivos reais de teste**

Repita o script node da Task 1, Step 2, mas só com estes 2 casos (os arquivos reais já
presentes na pasta de teste do Drive nesta sessão):
```
"Crie uma imagem de um cachorro em um gramado.png" → descritivo (não-null)
"20251022_2126_New Video_simple_compose_01k877bc1mfm59en0zkzg7ph8g.mp4" → null
```
Expected: os dois casos batem com o comportamento esperado (documentar no report se
algum divergir — não deveria, já coberto pela Task 1).

**Step 4: Atualizar PLAN.md**

Adicionar uma entrada `[x]` no M11 (mesmo padrão das entradas de 14/07/2026 já
registradas nesta sessão) resumindo: arquivos criados/modificados, a heurística de nome
descritivo (com os 2 exemplos reais), e que agora tanto Drive quanto "Post rápido"
aceitam mídia sem contexto explícito, com o mesmo fallback por tipo de mídia de antes
(vídeo se auto-analisa; imagem sem contexto utilizável grava erro explícito pra edição
manual). Deixe claro que **nenhuma mudança** foi feita em `generateCopy.ts`/`prompts.ts`/
no cron `generate-copy` — só o que alimenta `source_fact` mudou.

**Step 5: Commit final**

```bash
git add PLAN.md
git commit -m "docs(plan): registra ingestao do Drive sem .json obrigatorio no PLAN.md"
```

(Não faça push — o controlador revisa a branch inteira antes do push final.)
