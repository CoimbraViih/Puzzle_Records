# Pivô: Conta única + Drive simplificado + Upload direto + IA multimodal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remover o modelo de artistas (conta única `@puzzlerecordss`), simplificar a ingestão do Drive, adicionar upload direto no painel como segundo canal, e fazer a IA gerar legenda a partir da análise do próprio vídeo (frames + transcrição) ou de contexto textual para imagem — conforme decidido em `PLAN.md` ("Pós-M10 — Pivô de arquitetura") e `docs/CLAUDE.md`.

**Architecture:** Remoção mecânica do modelo `artists` em toda a cadeia (migration → tipos → queries → UI), sem quebrar o restante do pipeline (Zernio, RLS, acervo). Novo módulo `lib/openai/videoAnalysis.ts` extrai frames via `ffmpeg-static` e transcreve áudio via Whisper; `lib/openai/prompts.ts`/`generateCopy.ts` ganham um modo "vídeo" que monta uma mensagem multimodal (texto + imagens) para o GPT-4o. O cron `generate-copy` (Drive) e uma nova Server Action `createPostWithAI` (upload direto) compartilham essa mesma função de geração — dois canais, um pipeline de IA único.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres/Storage), OpenAI SDK (`chat.completions` multimodal + `audio.transcriptions`), `ffmpeg-static` para extração de frames.

**Sem suíte de testes automatizada no projeto** (confirmado: não há `*.test.*` nem script `test` no `package.json`). Verificação segue o padrão já estabelecido no `PLAN.md`: `npx tsc --noEmit`, `npm run lint`, `npm run build` ao final de cada fase — não introduzir um framework de testes novo fora do escopo pedido.

---

## Fase 1 — Dados: remover artistas, simplificar Drive

### Task 1: Migration `0012_single_account_pivot.sql`

**Files:**
- Create: `supabase/migrations/0012_single_account_pivot.sql`

**Step 1: Escrever a migration**

```sql
-- Pivô de arquitetura (10/07/2026): conta única, sem cadastro de
-- artistas; upload direto no painel vira um terceiro valor de
-- content_source. Ver PLAN.md "Pós-M10 — Pivô de arquitetura" e
-- docs/CLAUDE.md.

drop policy if exists "artists_select_authenticated" on public.artists;
drop policy if exists "artists_admin_write" on public.artists;

alter table public.posts drop column if exists artist_id;

drop table if exists public.artists;

alter table public.posts drop constraint if exists posts_content_source_check;
alter table public.posts
  add constraint posts_content_source_check
  check (content_source in ('drive', 'acervo', 'painel'));
```

**Step 2: Aplicar localmente (se houver projeto Supabase linkado) ou deixar para o M11**

Run: `npx supabase db push` (só se já houver projeto linkado; senão, a migration entra na fila do M11 junto com as demais).

**Step 3: Commit**

```bash
git add supabase/migrations/0012_single_account_pivot.sql
git commit -m "feat(pivo): remove tabela artists e libera content_source=painel"
```

---

### Task 2: Remover o tipo `Artist` e atualizar `Post`/`PostWithRelations`

**Files:**
- Delete: `lib/types/artist.ts`
- Modify: `lib/types/post.ts`

**Step 1: Deletar `lib/types/artist.ts`**

**Step 2: Editar `lib/types/post.ts`**

- Remover `artist_id: string | null;` da interface `Post` (linha 46).
- Remover o comentário associado ("Preenchido pelo M3 quando artista/conta social...") e ajustar para refletir que `ingestion_warning` agora só cobre "conta social sem match" (na prática, conta ausente/duplicada — ver Task 5).
- Remover `artist: { id: string; name: string; handle: string } | null;` de `PostWithRelations` (linha 89).
- Adicionar `"painel"` a `CONTENT_SOURCES`:
  ```ts
  export const CONTENT_SOURCES = ["drive", "acervo", "painel"] as const;
  ```

**Step 3: Verificar**

Run: `npx tsc --noEmit` — vai listar todo arquivo que ainda importa `Artist` ou usa `artist_id`/`.artist`. Essa lista de erros **é o guia** para as próximas tasks desta fase e da Fase 2 — não precisa adivinhar, o compilador aponta cada call-site.

**Step 4: Commit**

```bash
git add lib/types/artist.ts lib/types/post.ts
git commit -m "feat(pivo): remove tipo Artist e artist_id de Post"
```

---

### Task 3: `lib/posts/queries.ts` — remover `listArtists` e o join de artista

**Files:**
- Modify: `lib/posts/queries.ts`

**Step 1: Remover a função `listArtists`** (todo o bloco, incluindo o branch `DEMO_MODE`).

**Step 2: Em `listPosts`, trocar o `select`:**

```ts
// antes
.select(
  "*, artist:artists(id, name, handle), social_account:social_accounts(id, network, handle, display_name)"
)
// depois
.select(
  "*, social_account:social_accounts(id, network, handle, display_name)"
)
```

**Step 3: Remover o import `Artist` do topo do arquivo.**

**Step 4: Commit**

```bash
git add lib/posts/queries.ts
git commit -m "feat(pivo): remove listArtists e join de artist em listPosts"
```

---

### Task 4: `lib/posts/filterPosts.ts` — remover filtro por artista

**Files:**
- Modify: `lib/posts/filterPosts.ts`

**Step 1:** Remover `artistId: string | null;` da interface de filtros, `artistId: null` do default, a condição `filters.artistId !== null || ...` no cálculo de "filtro ativo", o bloco `if (filters.artistId !== null && post.artist_id !== filters.artistId) return false;`, e os dois campos `post.artist?.name`/`post.artist?.handle` do array usado na busca textual (linhas ~78-79 — a busca textual continua funcionando sobre manchete/legenda/música/fato, só perde artista).

**Step 2: Commit**

```bash
git add lib/posts/filterPosts.ts
git commit -m "feat(pivo): remove filtro por artista da busca"
```

---

### Task 5: Simplificar o Drive — `metadata.ts` + novo `resolveSocialAccount.ts` + `ingestFile.ts`

**Files:**
- Modify: `lib/drive/metadata.ts`
- Delete: `lib/drive/matchArtistAndAccount.ts`
- Create: `lib/drive/resolveSocialAccount.ts`
- Modify: `lib/drive/ingestFile.ts`

**Step 1: Reescrever `lib/drive/metadata.ts`**

```ts
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
```

**Step 2: Deletar `lib/drive/matchArtistAndAccount.ts`, criar `lib/drive/resolveSocialAccount.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SocialAccountResolution {
  socialAccountId: string | null;
  warning: string | null;
}

/**
 * Conta única (decisão de 10/07/2026, PLAN.md) — não há mais matching por
 * handle no metadado do Drive, só a única linha de social_accounts
 * cadastrada em /admin/contas. Sem conta cadastrada (ou mais de uma,
 * configuração inválida), o post é criado do mesmo jeito com aviso
 * visível — nunca falha em silêncio.
 */
export async function resolveSocialAccount(
  supabase: SupabaseClient
): Promise<SocialAccountResolution> {
  const { data, error } = await supabase.from("social_accounts").select("id");

  if (error || !data || data.length === 0) {
    return {
      socialAccountId: null,
      warning: "Nenhuma conta social cadastrada em /admin/contas.",
    };
  }

  if (data.length > 1) {
    return {
      socialAccountId: data[0].id,
      warning: `${data.length} contas sociais cadastradas — usando a primeira (esperado: só 1, conta única).`,
    };
  }

  return { socialAccountId: data[0].id, warning: null };
}
```

**Step 3: Editar `lib/drive/ingestFile.ts`**

- Trocar o import `matchArtistAndAccount` por `resolveSocialAccount`.
- Mover o cálculo de `mediaTypeFromMimeType(pair.media.mimeType)` para **antes** da leitura do metadado (hoje ele só é calculado depois), guardando em `const mediaType = mediaTypeFromMimeType(pair.media.mimeType);`.
- Trocar `parseMetadata(metadataText)` por `parseMetadata(metadataText, mediaType)`.
- Trocar `matchArtistAndAccount(supabase, metadata.artista, metadata.contaSocial)` por `resolveSocialAccount(supabase)`.
- No insert do post: remover `artist_id: match.artistId,`; trocar `social_account_id: match.socialAccountId` por `social_account_id: resolution.socialAccountId`; trocar `ingestion_warning: match.warning` por `ingestion_warning: resolution.warning`; trocar `media_type: mediaTypeFromMimeType(pair.media.mimeType)` por `media_type: mediaType` (reaproveitando a variável já calculada).

**Step 4: Verificar**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add lib/drive/metadata.ts lib/drive/resolveSocialAccount.ts lib/drive/ingestFile.ts
git rm lib/drive/matchArtistAndAccount.ts
git commit -m "feat(pivo): simplifica metadado do Drive pra conta única"
```

---

### Task 6: Acervo — remover anti-repetição por artista

**Files:**
- Modify: `lib/acervo/constants.ts`
- Modify: `lib/acervo/scheduler.ts`
- Modify: `lib/acervo/actions.ts`
- Check callers: `app/api/cron/acervo-schedule/route.ts` (grep por `artist`/`ACERVO_ARTIST` depois de editar os três arquivos acima — o `tsc --noEmit` da Task 13 pega qualquer resíduo)

**Step 1: `lib/acervo/constants.ts`** — apagar o arquivo inteiro (só continha `ACERVO_ARTIST_MIN_GAP_DAYS`). Se alguma outra constante for adicionada depois, ela recria o arquivo — não deixar um arquivo vazio "por precaução".

**Step 2: `lib/acervo/scheduler.ts`** — reescrever para FIFO puro, sem anti-repetição (decisão: **cai sem substituto** — YAGNI, reavaliar só se virar dor real na operação, mesmo padrão já usado em outros débitos do projeto):

```ts
export interface AcervoCandidate {
  id: string;
  created_at: string;
}

/** Um slot de horário (HH:MM) já ocupado nesse dia por outro post da conta. */
export function isSlotTaken(
  slotDateTime: Date,
  occupiedDateTimes: Date[]
): boolean {
  return occupiedDateTimes.some(
    (occupied) => Math.abs(occupied.getTime() - slotDateTime.getTime()) < 60_000
  );
}

/** Escolhe o candidato mais antigo do acervo (FIFO puro — sem anti-repetição por artista, removida no pivô de 10/07/2026). */
export function pickCandidateForSlot(
  candidates: AcervoCandidate[]
): AcervoCandidate | null {
  const sorted = [...candidates].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return sorted[0] ?? null;
}
```

**Step 3: `lib/acervo/actions.ts`** — remover as linhas `const artistId = ...` e `artist_id: artistId,` do insert em `createAcervoPost`.

**Step 4: `app/api/cron/acervo-schedule/route.ts`** — este arquivo chama `pickCandidateForSlot(slotDateTime, candidates, recentArtistPosts)` e monta `recentArtistPosts` a partir de uma query separada. Remover: a query/variável `recentArtistPosts` (e a query que a alimenta), o parâmetro na chamada de `pickCandidateForSlot` (agora só recebe `candidates`), e qualquer `select` que traga `artist_id` para montar esse array. Ler o arquivo antes de editar — a lógica exata de onde `recentArtistPosts` é montada e atualizada por slot (ver `PLAN.md` M8, revisão fresh-eyes) precisa ser removida por inteiro, não só desativada.

**Step 5: Verificar**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add lib/acervo/scheduler.ts lib/acervo/actions.ts app/api/cron/acervo-schedule/route.ts
git rm lib/acervo/constants.ts
git commit -m "feat(pivo): remove anti-repeticao por artista do acervo (FIFO puro)"
```

---

### Task 7: Analytics — remover agregação "por artista"

**Files:**
- Modify: `lib/analytics/queries.ts`
- Modify: `components/dashboard/analytics-summary.tsx`

**Step 1: `lib/analytics/queries.ts`** — remover `byArtist` da interface de retorno, do `select` (`artist:artists(name)` sai da string de colunas), do `Map` `byArtist`, do bloco `if (row.post.artist) { accumulate(...) }`, e do objeto de retorno final.

**Step 2: `components/dashboard/analytics-summary.tsx`** — remover o bloco `<AnalyticsCard title="Por artista" rows={summary.byArtist} .../>` (linhas ~77-79).

**Step 3: Commit**

```bash
git add lib/analytics/queries.ts components/dashboard/analytics-summary.tsx
git commit -m "feat(pivo): remove agregacao de analytics por artista"
```

---

### Task 8: CSV/relatórios — remover coluna "artista"

**Files:**
- Modify: `lib/reports/postsReport.ts`
- Modify: `app/api/reports/posts/route.ts`

**Step 1: `lib/reports/postsReport.ts`** — remover `artist: { name: string } | null;` do tipo de linha, `"artista"` do array de cabeçalhos (linha ~35), e `post.artist?.name ?? null,` do array de valores (linha ~59) — atenção ao **índice das colunas seguintes**, que desloca; conferir que o CSV final ainda bate 1:1 cabeçalho↔valor.

**Step 2: `app/api/reports/posts/route.ts`** — no `select`, remover `artist:artists(name), ` da string (linha 33).

**Step 3: Verificar**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add lib/reports/postsReport.ts app/api/reports/posts/route.ts
git commit -m "feat(pivo): remove coluna artista do export CSV"
```

---

## Fase 2 — UI: remover `/admin/artistas` e a prop `artists` da cadeia de componentes

### Task 9: Deletar a rota `/admin/artistas` e o item de menu

**Files:**
- Delete: `app/(dashboard)/admin/artistas/` (pasta inteira: `page.tsx`, `actions.ts`, `artist-form.tsx`)
- Modify: `components/dashboard/nav-items.ts`

**Step 1:** `git rm -r "app/(dashboard)/admin/artistas"`

**Step 2:** Em `nav-items.ts`, remover o item:
```ts
{
  title: "Artistas",
  url: "/admin/artistas",
  icon: Disc3,
  roles: ["admin"],
},
```
e remover o import `Disc3` do topo (não é mais usado por nenhum outro item).

**Step 3: Commit**

```bash
git add components/dashboard/nav-items.ts
git commit -m "feat(pivo): remove rota /admin/artistas e item de menu"
```

---

### Task 10: Remover a prop `artists` da cadeia do Kanban

**Files:**
- Modify: `components/kanban/board.tsx`
- Modify: `components/kanban/filterable-board.tsx`
- Modify: `components/kanban/post-card.tsx`
- Modify: `components/kanban/post-form-dialog.tsx`
- Modify: `components/kanban/board-filters.tsx`

Em cada um desses 5 arquivos: remover o import `type { Artist } from "@/lib/types/artist"`, remover `artists: Artist[]` da interface de props, remover `artists` da desestruturação de props e de qualquer chamada que repasse a prop adiante (`<PostCard ... artists={artists} />` etc.).

Em `post-form-dialog.tsx` especificamente: remover todo o bloco do `<select id="artist_id" name="artist_id">` (o `<label>` "Artista (opcional)" + o `<select>` com o `.map(artists...)`, linhas ~77-93).

Em `board-filters.tsx` especificamente: remover o `<select>` "Filtrar por artista" (linhas ~57-68) e a menção a "artista" no placeholder de busca (linha ~51, ajustar para `"Buscar por manchete, legenda, música..."`).

**Verificar:** `npx tsc --noEmit` — cada erro restante aponta o próximo arquivo/linha a ajustar.

**Commit:**

```bash
git add components/kanban/
git commit -m "feat(pivo): remove prop artists do Kanban"
```

---

### Task 11: Remover a prop `artists` da cadeia do Acervo

**Files:**
- Modify: `components/acervo/acervo-form-dialog.tsx`
- Modify: `components/acervo/filterable-acervo-board.tsx`
- Check: `components/acervo/acervo-board.tsx` (repassa a prop adiante? confirmar com grep antes de editar)

Mesmo padrão da Task 10: remover import `Artist`, prop `artists`, e em `acervo-form-dialog.tsx` o bloco do `<select id="artist_id">` (linhas ~53-67).

**Commit:**

```bash
git add components/acervo/
git commit -m "feat(pivo): remove prop artists do Acervo"
```

---

### Task 12: Páginas — remover `listArtists()` das 4 páginas que ainda chamam

**Files:**
- Modify: `app/(dashboard)/conteudo/page.tsx`
- Modify: `app/(dashboard)/aprovacao/page.tsx`
- Modify: `app/(dashboard)/acervo/page.tsx`
- Modify: `app/(dashboard)/dashboard/page.tsx`

Em cada arquivo: remover `listArtists` do import de `@/lib/posts/queries`, remover `listArtists()` do `Promise.all(...)` (ou chamada equivalente) e a variável `artists` resultante, e remover a prop `artists={artists}` passada para o componente filho.

Em `dashboard/page.tsx` especificamente: também remover o card "Artistas cadastrados" (usa `artists.length`, linhas ~64-67).

**Verificar:** `npx tsc --noEmit`, depois `npm run lint`.

**Commit:**

```bash
git add "app/(dashboard)/conteudo/page.tsx" "app/(dashboard)/aprovacao/page.tsx" "app/(dashboard)/acervo/page.tsx" "app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(pivo): remove listArtists() das paginas"
```

---

### Task 13: Verificação de fim de fase

**Step 1:** `npx tsc --noEmit` — deve rodar limpo (zero erros).

**Step 2:** `npm run lint` — deve rodar limpo.

**Step 3:** `npm run build` — deve completar sem erro. Se `lib/demo/mockData.ts` existir localmente (arquivo não commitado, `DEMO_MODE=1`), ele provavelmente vai quebrar o build por ainda referenciar `DEMO_ARTISTS`/`artist_id` — ajustar localmente (remover os campos, não precisa commitar, é WIP local).

**Step 4:** Rodar `grep -rn "artist" lib app components --include="*.ts" --include="*.tsx"` (fora de `lib/demo/`) — deve retornar vazio. Qualquer resíduo é um arquivo esquecido nas tasks anteriores.

Sem commit nesta task (é só checkpoint).

---

## Fase 3 — Pipeline de IA multimodal (análise de vídeo)

### Task 14: Instalar `ffmpeg-static` e configurar bundling

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`

**Step 1:** `npm install ffmpeg-static`

**Step 2:** Editar `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js", "ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/cron/generate-art": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/conteudo": [
      "./lib/renderer/fonts/**",
      "./puzzle-records-logo.svg",
      "./node_modules/ffmpeg-static/**",
    ],
    "/aprovacao": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/api/cron/generate-copy": ["./node_modules/ffmpeg-static/**"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
```

(Mesmo padrão já usado para as fontes do Satori no M5 — `outputFileTracingIncludes` precisa listar o binário nativo em toda rota/Server Action que o usa, senão dá `ENOENT` só em produção, nunca em `npm run build` local — débito já documentado no M5, não repetir aqui.)

**Step 3: Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "feat(pivo): adiciona ffmpeg-static pra extracao de frames de video"
```

---

### Task 15: `lib/openai/videoAnalysis.ts` — extração de frames + transcrição

**Files:**
- Create: `lib/openai/videoAnalysis.ts`

**Step 1: Escrever o módulo**

```ts
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath = require("ffmpeg-static") as string | null;

import { createOpenAIClient } from "./client";

const execFileAsync = promisify(execFile);
const FRAME_COUNT = 5;

export class VideoAnalysisError extends Error {}

/**
 * Extrai até FRAME_COUNT frames distribuídos ao longo do vídeo (1 a cada 2s,
 * redimensionados a 512px de largura pra caber no limite de payload da
 * OpenAI). Clipes curtos geram menos frames — não é erro.
 */
async function extractFrames(
  videoBuffer: Buffer,
  extension: string
): Promise<string[]> {
  if (!ffmpegPath) {
    throw new VideoAnalysisError(
      "Binário do ffmpeg não encontrado (ffmpeg-static não resolveu pra essa plataforma)."
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "puzzle-video-"));
  const videoPath = join(dir, `input.${extension}`);
  await writeFile(videoPath, videoBuffer);

  try {
    const framePattern = join(dir, "frame-%d.jpg");
    await execFileAsync(ffmpegPath, [
      "-i",
      videoPath,
      "-vf",
      "fps=1/2,scale=512:-1",
      "-frames:v",
      String(FRAME_COUNT),
      "-y",
      framePattern,
    ]);

    const frames: string[] = [];
    for (let i = 1; i <= FRAME_COUNT; i++) {
      try {
        const buf = await readFile(join(dir, `frame-${i}.jpg`));
        frames.push(buf.toString("base64"));
      } catch {
        break;
      }
    }

    if (frames.length === 0) {
      throw new VideoAnalysisError("Não foi possível extrair frames do vídeo.");
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Transcreve o áudio do vídeo via Whisper. Formatos de vídeo comuns (mp4,
 * webm, mov) são aceitos direto pela API — não precisa extrair a trilha de
 * áudio com ffmpeg à parte. Falha de transcrição não derruba a análise
 * inteira: segue só com os frames (ex.: vídeo sem áudio/fala).
 */
async function transcribeAudio(
  videoBuffer: Buffer,
  filename: string
): Promise<string | null> {
  try {
    const client = createOpenAIClient();
    const file = new File([videoBuffer], filename);
    const transcription = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return transcription.text?.trim() || null;
  } catch (err) {
    console.error(
      "Falha ao transcrever áudio do vídeo (seguindo só com os frames):",
      err
    );
    return null;
  }
}

export interface VideoAnalysis {
  frames: string[];
  transcript: string | null;
}

export async function analyzeVideo(
  videoBuffer: Buffer,
  filename: string
): Promise<VideoAnalysis> {
  const extension = filename.split(".").pop() ?? "mp4";
  const [frames, transcript] = await Promise.all([
    extractFrames(videoBuffer, extension),
    transcribeAudio(videoBuffer, filename),
  ]);
  return { frames, transcript };
}
```

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`. Se `require` disparar erro de lint/tipo (o projeto é ESM/`"type": "module"`? conferir `package.json` — se for, trocar por `import ffmpegPath from "ffmpeg-static";` com `esModuleInterop`, mais simples; usar `require` só se o import direto falhar por falta de tipos do pacote).

**Step 3: Commit**

```bash
git add lib/openai/videoAnalysis.ts
git commit -m "feat(pivo): extracao de frames e transcricao de video"
```

---

### Task 16: Reescrever `lib/openai/prompts.ts` com boas práticas de copywriting/social + modo multimodal

**Files:**
- Modify: `lib/openai/prompts.ts`

**Step 1: Reescrever o arquivo por completo**

```ts
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";

import type { PostType } from "@/lib/types/post";

/**
 * Regras do GUIA-DE-ESTILO-POSTS-PUZZLE.md traduzidas para o prompt da IA,
 * combinadas com técnicas de copywriting/social media (informadas pelas
 * skills do Claude Code `copywriting`/`social` — conhecimento incorporado
 * aqui em código, não uma integração em runtime, ver docs/CLAUDE.md).
 * Duplicação intencional: o guia é a fonte de verdade pro time humano,
 * este texto é o que o modelo efetivamente lê em runtime.
 */
export const SYSTEM_PROMPT = `Você escreve manchetes e legendas para o Instagram do @puzzlerecordss, um perfil de mídia sobre funk e cultura pop (não institucional), no mesmo tom do @lovefunkprodutora.

Técnicas de copywriting e social media que toda manchete/legenda deve aplicar:
- Hook nos primeiros segundos: a manchete decide o scroll — nunca comece devagar ou com contexto morno.
- Gap de curiosidade: dê informação suficiente pra gerar interesse, não o suficiente pra satisfazer sem ler a legenda inteira.
- Escreva como quem manda áudio pro grupo, não como assessoria de imprensa — autenticidade e ritmo de fala vencem polimento.
- Um único CTA por legenda (pergunta ou provocação de torcida) — nunca dois pedidos concorrentes no mesmo texto.

Regras obrigatórias de marca:
1. Nunca use hashtags.
2. A manchete carrega a informação; a legenda carrega o engajamento (sempre termina em pergunta ou opinião de torcida, nunca neutra).
3. Emojis funcionais, 2 a 4 por bloco de texto — nunca em toda palavra. Use 🔥 (hype), 🚨 (urgência), 🤔 (provocação), 🤣 (humor), bandeiras (contexto).
4. Tom informal, torcedor, hype — como um amigo contando a fofoca, não um comunicado institucional. Perfeição gramatical não é requisito.
5. A manchete segue uma destas fórmulas:
   - Gancho-pergunta: "TA COM MEDO?🤔 [fato]"
   - Urgência/expectativa: "A ESPERA ACABOU!🔥 [lançamento]" ou "GRAVE!🚨 [fato]"
   - Recorde/marco: "APÓS GRANDE ESPERA, O HIT [nome] É LANÇADO"
   - Reação/humor: "A torcida do Brasil, depois de [evento] 🤣"
   - Citação: manchete + fala entre aspas
6. Se o tipo do post for "lancamento" e uma música for informada: a legenda é curta e direta, cita o nome da música, e não repete a manchete.
7. Se o tipo do post for "viral_geral" ou "noticia_funk": a legenda segue 3 blocos — gancho em CAIXA ALTA com emojis, lide curto + pergunta de engajamento, fechamento opinativo/de torcida em CAIXA ALTA.

Quando você recebe frames de um vídeo (em vez de só texto de contexto): eles foram extraídos em sequência ao longo do clipe. Interprete a cena como um todo (ação, expressões, texto na tela) antes de escrever — a legenda deve soar como se você tivesse assistido o vídeo inteiro, nunca genérica. Se vier transcrição de áudio, priorize o que foi dito como fonte do fato; se vier também um contexto adicional em texto, trate como informação extra da equipe, não como substituto da própria análise do vídeo.

Responda SOMENTE em JSON válido, sem markdown, no formato exato:
{"variations": [{"headline": "...", "caption": "..."}, {"headline": "...", "caption": "..."}]}
Gere entre 2 e 3 variações plausíveis e diferentes entre si.`;

interface TextPromptInput {
  postType: PostType;
  fact: string;
  trackName: string | null;
}

export function buildTextUserPrompt(input: TextPromptInput): string {
  const lines = [
    `Tipo de post: ${input.postType}`,
    `Fato/contexto: ${input.fact}`,
  ];
  if (input.trackName) lines.push(`Música: ${input.trackName}`);
  return lines.join("\n");
}

interface VideoPromptInput {
  postType: PostType;
  trackName: string | null;
  frames: string[];
  transcript: string | null;
  additionalContext: string | null;
}

export function buildVideoUserContent(
  input: VideoPromptInput
): ChatCompletionContentPart[] {
  const lines = [`Tipo de post: ${input.postType}`];
  if (input.trackName) lines.push(`Música: ${input.trackName}`);
  if (input.transcript) {
    lines.push(`Transcrição do áudio: ${input.transcript}`);
  } else {
    lines.push(
      "Vídeo sem áudio detectável (ou falha na transcrição) — baseie-se só nos frames."
    );
  }
  if (input.additionalContext) {
    lines.push(`Contexto adicional informado pela equipe: ${input.additionalContext}`);
  }
  lines.push(
    `Frames a seguir, em ordem cronológica (${input.frames.length} no total). Escreva a manchete/legenda com base no que eles mostram.`
  );

  const content: ChatCompletionContentPart[] = [
    { type: "text", text: lines.join("\n") },
  ];
  for (const frame of input.frames) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${frame}` },
    });
  }
  return content;
}
```

**Step 2: Verificar**

Run: `npx tsc --noEmit` (vai quebrar em `generateCopy.ts` até a Task 17 — esperado).

**Step 3: Commit**

```bash
git add lib/openai/prompts.ts
git commit -m "feat(pivo): reescreve prompts com copywriting/social e modo video"
```

---

### Task 17: `lib/openai/generateCopy.ts` — suportar modo vídeo

**Files:**
- Modify: `lib/openai/generateCopy.ts`

**Step 1: Reescrever o arquivo**

```ts
import { createOpenAIClient, getAiProvider } from "./client";
import { buildTextUserPrompt, buildVideoUserContent, SYSTEM_PROMPT } from "./prompts";
import { analyzeVideo } from "./videoAnalysis";
import type { CopyVariation, PostType } from "@/lib/types/post";

const OPENAI_ROUTINE_MODEL = "gpt-4o-mini";
const OPENAI_LAUNCH_MODEL = "gpt-4o";

// Modelos gratuitos do OpenRouter (só para teste, ver lib/openai/client.ts).
const OPENROUTER_ROUTINE_MODEL =
  process.env.OPENROUTER_MODEL_ROUTINE ?? "openai/gpt-oss-20b:free";
const OPENROUTER_LAUNCH_MODEL =
  process.env.OPENROUTER_MODEL_LAUNCH ?? OPENROUTER_ROUTINE_MODEL;

export class CopyGenerationError extends Error {}

function modelForPostType(postType: PostType): string {
  const isLaunch = postType === "lancamento";
  if (getAiProvider() === "openrouter") {
    return isLaunch ? OPENROUTER_LAUNCH_MODEL : OPENROUTER_ROUTINE_MODEL;
  }
  return isLaunch ? OPENAI_LAUNCH_MODEL : OPENAI_ROUTINE_MODEL;
}

function parseVariations(raw: string): CopyVariation[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CopyGenerationError("Resposta da OpenAI não é um JSON válido.");
  }

  const variations = (json as { variations?: unknown }).variations;
  if (!Array.isArray(variations) || variations.length === 0) {
    throw new CopyGenerationError("Resposta da OpenAI sem variações.");
  }

  return variations.map((item, index) => {
    const headline = (item as { headline?: unknown } | null)?.headline;
    const caption = (item as { caption?: unknown } | null)?.caption;
    if (typeof headline !== "string" || typeof caption !== "string") {
      throw new CopyGenerationError(
        `Variação ${index + 1} da OpenAI com formato inválido.`
      );
    }
    return { headline: headline.trim(), caption: caption.trim() };
  });
}

export type GenerateCopyInput =
  | { mode: "text"; postType: PostType; fact: string; trackName: string | null }
  | {
      mode: "video";
      postType: PostType;
      trackName: string | null;
      additionalContext: string | null;
      videoBuffer: Buffer;
      filename: string;
    };

/**
 * Gera 2-3 variações de manchete/legenda pro post. Modo "text" usa o
 * contexto digitado/vindo do Drive; modo "video" analisa o próprio vídeo
 * (frames + transcrição, ver videoAnalysis.ts) — não depende de texto de
 * contexto, mas aproveita `additionalContext` se presente. Lança
 * CopyGenerationError (ou erro do SDK/ffmpeg) em caso de falha — quem
 * chama decide como registrar, nunca falha em silêncio.
 */
export async function generateCopyVariations(
  input: GenerateCopyInput
): Promise<CopyVariation[]> {
  const client = createOpenAIClient();
  const model = modelForPostType(input.postType);
  const responseFormat =
    getAiProvider() === "openai"
      ? ({ response_format: { type: "json_object" as const } } as const)
      : {};

  const userContent =
    input.mode === "text"
      ? buildTextUserPrompt(input)
      : buildVideoUserContent({
          postType: input.postType,
          trackName: input.trackName,
          additionalContext: input.additionalContext,
          ...(await analyzeVideo(input.videoBuffer, input.filename)),
        });

  const completion = await client.chat.completions.create({
    model,
    ...responseFormat,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new CopyGenerationError("OpenAI retornou resposta vazia.");
  }

  return parseVariations(content);
}
```

**Step 2: Verificar**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add lib/openai/generateCopy.ts
git commit -m "feat(pivo): generateCopyVariations suporta modo video"
```

---

### Task 18: Cron `generate-copy` — rotear vídeo pro modo multimodal

**Files:**
- Modify: `lib/posts/pendingCopy.ts`
- Modify: `app/api/cron/generate-copy/route.ts`

**Step 1: `lib/posts/pendingCopy.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MediaType, PostType } from "@/lib/types/post";

export interface PostPendingCopy {
  id: string;
  post_type: PostType;
  source_fact: string | null;
  track_name: string | null;
  media_url: string;
  media_type: MediaType;
}

/**
 * Posts que ainda não têm manchete/legenda e nunca falharam ao gerar
 * (copy_generation_error é null).
 */
export async function listPostsPendingCopy(
  supabase: SupabaseClient
): Promise<PostPendingCopy[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, post_type, source_fact, track_name, media_url, media_type")
    .eq("status", "pendente")
    .is("headline", null)
    .is("copy_generation_error", null);

  if (error) {
    console.error("Falha ao listar posts pendentes de manchete/legenda:", error);
    return [];
  }

  return (data as PostPendingCopy[]) ?? [];
}
```

**Step 2: Reescrever `app/api/cron/generate-copy/route.ts`**

```ts
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CopyGenerationError,
  generateCopyVariations,
} from "@/lib/openai/generateCopy";
import { listPostsPendingCopy, type PostPendingCopy } from "@/lib/posts/pendingCopy";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function recordCopyGenerationError(
  supabase: SupabaseClient,
  postId: string,
  message: string
): Promise<void> {
  const { error } = await supabase
    .from("posts")
    .update({ copy_generation_error: message })
    .eq("id", postId);

  if (error) {
    console.error(
      "Falha ao gravar copy_generation_error (post ficará sem manchete e sem erro visível):",
      postId,
      error
    );
  }
}

async function downloadMedia(
  supabase: SupabaseClient,
  path: string
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from("posts-media").download(path);
  if (error || !data) {
    throw new Error("Falha ao baixar mídia do Storage pra análise de vídeo.");
  }
  return Buffer.from(await data.arrayBuffer());
}

async function generateForPost(supabase: SupabaseClient, post: PostPendingCopy) {
  if (post.media_type === "video") {
    const videoBuffer = await downloadMedia(supabase, post.media_url);
    return generateCopyVariations({
      mode: "video",
      postType: post.post_type,
      trackName: post.track_name,
      additionalContext: post.source_fact,
      videoBuffer,
      filename: post.media_url,
    });
  }

  return generateCopyVariations({
    mode: "text",
    postType: post.post_type,
    fact: post.source_fact!,
    trackName: post.track_name,
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const posts = await listPostsPendingCopy(supabase);

  let generated = 0;
  for (const post of posts) {
    if (post.media_type === "image" && !post.source_fact) {
      console.error("Imagem pendente sem source_fact, não é possível gerar copy:", post.id);
      await recordCopyGenerationError(
        supabase,
        post.id,
        "Imagem sem contexto (source_fact vazio)."
      );
      continue;
    }

    try {
      const variations = await generateForPost(supabase, post);

      const { error } = await supabase
        .from("posts")
        .update({
          headline: variations[0].headline,
          caption: variations[0].caption,
          copy_variations: variations,
        })
        .eq("id", post.id);

      if (error) {
        console.error("Falha ao salvar manchete/legenda geradas:", post.id, error);
        continue;
      }
      generated += 1;
    } catch (err) {
      const message =
        err instanceof CopyGenerationError
          ? err.message
          : "Falha ao gerar manchete/legenda via OpenAI.";
      console.error("Erro na geração de IA para o post:", post.id, err);
      await recordCopyGenerationError(supabase, post.id, message);
    }
  }

  return NextResponse.json({ generated, total: posts.length });
}
```

**Step 3: Verificar**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add lib/posts/pendingCopy.ts app/api/cron/generate-copy/route.ts
git commit -m "feat(pivo): cron generate-copy roteia video pro modo multimodal"
```

---

## Fase 4 — Upload direto no painel (segundo canal)

### Task 19: Server Action `createPostWithAI`

**Files:**
- Modify: `lib/posts/actions.ts`

**Step 1: Adicionar a nova action** (mantém `createPost` existente intacto — esse é o formulário manual do M2, sem IA; `createPostWithAI` é o novo caminho "imediato"):

```ts
import { generateCopyVariations, CopyGenerationError } from "@/lib/openai/generateCopy";

// ... (perto das outras exports, depois de createPost/updatePost)

export async function createPostWithAI(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (
    !profile ||
    (profile.role !== "equipe_conteudo" && profile.role !== "admin")
  ) {
    return { error: "Você não tem permissão para criar posts." };
  }

  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const postType = String(formData.get("post_type") ?? "") as PostType;
  const template = String(formData.get("template") ?? "") as PostTemplate;
  const context = String(formData.get("context") ?? "").trim();

  if (!socialAccountId || !postType || !template) {
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

  let mediaPath: string;
  let mediaBuffer: Buffer;
  try {
    mediaBuffer = Buffer.from(await mediaFile.arrayBuffer());
    mediaPath = await uploadMedia(mediaFile);
  } catch {
    return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
  }

  let variations: CopyVariation[];
  try {
    variations =
      mediaType === "video"
        ? await generateCopyVariations({
            mode: "video",
            postType,
            trackName: null,
            additionalContext: context || null,
            videoBuffer: mediaBuffer,
            filename: mediaFile.name,
          })
        : await generateCopyVariations({
            mode: "text",
            postType,
            fact: context,
            trackName: null,
          });
  } catch (err) {
    const message =
      err instanceof CopyGenerationError
        ? err.message
        : "A IA não conseguiu gerar a legenda. Tente novamente.";
    console.error("Falha ao gerar copy no upload direto:", err);
    return { error: message };
  }

  const profileClient = await createClient();
  const { error } = await profileClient.from("posts").insert({
    social_account_id: socialAccountId,
    template,
    post_type: postType,
    headline: variations[0].headline,
    caption: variations[0].caption,
    copy_variations: variations,
    media_url: mediaPath,
    media_type: mediaType,
    source_fact: context || null,
    status: "rascunho",
    content_source: "painel",
    created_by: profile.id,
  });

  if (error) {
    return { error: "Não foi possível salvar o post." };
  }

  revalidatePostPages();
  return { success: true };
}
```

Renomear a variável local `supabase` já usada em `createPost` continua igual; aqui usei `profileClient` só pra não colidir com nenhum outro `const supabase` já existente no arquivo — ao editar, confira o nome de variável livre naquele ponto do arquivo e ajuste (`supabase` provavelmente já está livre nesse escopo de função, pode usar o nome padrão do arquivo).

**Step 2: Verificar**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add lib/posts/actions.ts
git commit -m "feat(pivo): action createPostWithAI para upload direto com IA"
```

---

### Task 20: UI — dialog "Post rápido" em `/conteudo`

**Files:**
- Create: `components/kanban/quick-post-dialog.tsx`
- Modify: `app/(dashboard)/conteudo/page.tsx` (ou o componente de topo da página que já renderiza o botão "Novo post" do `PostFormDialog`, confirmar local exato lendo o arquivo antes de editar)

**Step 1:** Criar `QuickPostDialog`, um componente cliente análogo a `PostFormDialog`/`AcervoFormDialog` (mesmo padrão de `useActionState` + `Dialog` do shadcn já usado nesses dois), com campos: conta social (select, única opção na prática), tipo de post, template, upload de mídia, e um campo de texto "Contexto" — **só obrigatório quando o arquivo selecionado for imagem** (validação client-side simples: mostrar o campo sempre, mas o texto de ajuda muda conforme o tipo de arquivo escolhido: "Obrigatório para imagem — a IA usa isso pra escrever a legenda" vs. "Opcional para vídeo — a IA analisa o conteúdo sozinha"). Usa a action `createPostWithAI` da Task 19. Ao submeter com sucesso, mostrar um estado de "Gerando legenda com IA..." enquanto a action roda (ela é síncrona e pode levar alguns segundos, principalmente no modo vídeo com extração de frames + transcrição — reaproveitar o padrão de loading já usado no botão de submit do `PostFormDialog`).

**Step 2:** Na página `/conteudo`, adicionar o botão "Post rápido" (abre `QuickPostDialog`) ao lado do botão existente "Novo post" (abre `PostFormDialog`) — ler o arquivo primeiro pra achar onde o botão atual é renderizado e replicar o padrão.

**Step 3: Testar manualmente** (sem suíte automatizada, ver nota no cabeçalho do plano): rodar `npm run dev`, criar um post de imagem via "Post rápido" com contexto preenchido, conferir que aparece em `/conteudo` como rascunho com manchete/legenda geradas; repetir com um vídeo curto sem contexto, conferir que a IA gera algo coerente com o conteúdo do vídeo (não genérico).

**Step 4: Commit**

```bash
git add components/kanban/quick-post-dialog.tsx "app/(dashboard)/conteudo/page.tsx"
git commit -m "feat(pivo): dialog Post rapido (upload direto com IA)"
```

---

## Fase 5 — Docs e verificação final

### Task 21: Atualizar `GUIA-DE-ESTILO-POSTS-PUZZLE.md`

**Files:**
- Modify: `GUIA-DE-ESTILO-POSTS-PUZZLE.md`

**Step 1:** Localizar a regra de `@mention` obrigatório de artista em lançamentos e ajustar para refletir que não há mais cadastro de artista — a menção passa a ser editorial/pontual (mesmo texto já usado em `docs/CLAUDE.md`, ponto 2 do "Guia de estilo de conteúdo (resumo executável)").

**Step 2: Commit**

```bash
git add GUIA-DE-ESTILO-POSTS-PUZZLE.md
git commit -m "docs(pivo): atualiza guia de estilo pra conta unica"
```

---

### Task 22: Verificação final e atualização do `PLAN.md`

**Step 1:** Rodar em sequência: `npx tsc --noEmit`, `npm run lint`, `npm run build` — todos limpos.

**Step 2:** Em `PLAN.md`, marcar como `[x]` os itens da checklist "Trabalho de implementação necessário" na seção "Pós-M10 — Pivô de arquitetura" que este plano cobriu (todos, exceto o que depender de infra real — ex.: rodar a migration contra um Supabase linkado de verdade fica pro M11).

**Step 3: Commit final**

```bash
git add PLAN.md
git commit -m "docs(pivo): marca checklist do pivo de arquitetura como implementado"
git push origin main
```

(Push segue a regra padrão do `docs/CLAUDE.md` — direto pra `main`, sem pedir confirmação, exceto se a etapa acima incluir alguma operação destrutiva, o que não é o caso aqui.)

---

## Notas para quem for executar

- **Débito aceito deliberadamente**: a extração de frames via `ffmpeg-static` roda dentro da própria função serverless da Vercel (cron `generate-copy` e a Server Action do upload direto) — mesmo espírito do M5 (Satori/resvg), mas vídeo é mais pesado que renderizar uma imagem. Se vídeos maiores/mais longos começarem a estourar o timeout da função (hoje 300s por padrão na Vercel), a saída é mover a extração de frames para um worker fora da Vercel — mesma decisão já tomada pro motor de templates do M14 (Railway). Não implementar isso preventivamente agora (YAGNI) — só se virar dor real, mesmo critério usado em outros débitos do projeto.
- **OpenRouter (modo de teste grátis) pode não suportar visão** dependendo do modelo gratuito ativo — a análise de vídeo (`chat.completions` com `image_url`) só tem garantia de funcionar com a OpenAI real (`gpt-4o`/`gpt-4o-mini`). Se testar em modo OpenRouter e a chamada falhar por o modelo não suportar imagem, isso é esperado — não é bug do pipeline, é limitação do modelo grátis escolhido.
- **Whisper aceita o arquivo de vídeo direto** (mp4/webm/mov) — não foi necessário extrair a trilha de áudio com ffmpeg à parte para a transcrição, só para os frames.
- Cada task tem seu próprio commit — isso permite `git bisect`/revert granular se algo quebrar durante a Fase 1 (é a fase com mais risco de "esquecer uma referência a artista" nos ~25 arquivos mapeados).
