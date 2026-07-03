# M4 — Geração de manchete/legenda via OpenAI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, dispatching a fresh subagent per task with a code-reviewer pass between tasks.

**Goal:** Todo post que entra "pendente" pelo M3 recebe automaticamente, sem intervenção manual, 2–3 variações plausíveis de manchete/legenda no tom da Puzzle Records — a equipe de conteúdo pode escolher entre elas antes de enviar para aprovação.

**Architecture:** Um segundo cron da Vercel (`/api/cron/generate-copy`, a cada 5 minutos, mesmo padrão de autenticação via `CRON_SECRET` do M3) roda desacoplado do cron de ingestão do Drive — se a OpenAI cair, a ingestão continua funcionando, e vice-versa (mesmo princípio de camada isolada já usado para Drive/Zernio). A cada execução, busca posts com `status = 'pendente'`, `headline is null` e `copy_generation_error is null` (isso já dá idempotência: um post só é reprocessado se nunca tiver gerado copy com sucesso nem falhado antes), monta um prompt com o `source_fact`/`track_name`/artista do post e as regras do `GUIA-DE-ESTILO-POSTS-PUZZLE.md` (hardcoded no prompt — é conteúdo consumido em runtime, não duplicação de documentação), chama o modelo certo (`gpt-4o-mini` pra rotina, `gpt-4o` quando `post_type = 'lancamento'`), valida o JSON de resposta e grava as variações. A primeira variação vira `headline`/`caption` (mesmas colunas que o Kanban já lê desde o M2); todas ficam em `copy_variations` (jsonb) para a equipe trocar pela UI. Falha na geração nunca é silenciosa: grava `copy_generation_error` no post, visível na fila (mesmo padrão do `ingestion_warning` do M3), e o cron segue para o próximo post.

**Tech Stack:** Next.js 16 (Route Handler), Vercel Cron, SDK oficial `openai`, Supabase (Postgres, cliente service-role no cron / cliente autenticado na server action), TypeScript.

**Sem framework de testes automatizado no projeto** (mesma situação do M1–M3). Cada task usa `npx tsc --noEmit` + `npm run lint` como verificação de tipos/estilo; a lógica pura de parsing/validação da resposta da OpenAI (`parseVariations`) fica isolada em função pequena para revisão fácil. A Task final é um checklist de teste manual ponta a ponta contra uma chave OpenAI real.

---

### Task 1: Instalar o SDK da OpenAI

**Agent:** fullstack-developer

**Files:**
- Modify: `package.json`, `package-lock.json`

**Passos:**

1. Rodar `npm install openai` na raiz do projeto.
2. Rodar `npx tsc --noEmit` — deve continuar sem erros (nenhum código novo ainda).
3. Commit:

```bash
git add package.json package-lock.json
git commit -m "chore: adiciona SDK oficial da OpenAI"
```

---

### Task 2: Migração SQL — colunas de copy da IA

**Objetivo:** dar lugar para as variações geradas e para o erro de geração, sem quebrar nada do M2/M3.

**Files:**
- Create: `supabase/migrations/0004_ai_copy.sql`

**Passos:**

1. Criar `supabase/migrations/0004_ai_copy.sql`:

```sql
-- M4: manchete/legenda geradas pela OpenAI. copy_variations guarda as 2-3
-- variações retornadas pelo modelo (cada item: {headline, caption});
-- headline/caption (colunas já existentes desde o M2) sempre refletem a
-- variação selecionada. copy_generation_error espelha o ingestion_warning
-- do M3 — falha de geração nunca é silenciosa (ver docs/CLAUDE.md).
alter table public.posts
  add column copy_variations jsonb,
  add column copy_generation_error text;
```

2. Não precisa de policy nova: `copy_variations`/`copy_generation_error` são colunas de `posts`, já cobertas pelas RLS policies existentes da tabela (`0002_content_model.sql`).
3. Verificação: `npx tsc --noEmit` (não afeta TS ainda).
4. Commit:

```bash
git add supabase/migrations/0004_ai_copy.sql
git commit -m "feat(db): adiciona colunas de copy_variations e copy_generation_error em posts"
```

---

### Task 3: Tipos — `CopyVariation` e extensão de `Post`

**Files:**
- Modify: `lib/types/post.ts`

**Passos:**

1. Adicionar ao final de `lib/types/post.ts`:

```ts
export interface CopyVariation {
  headline: string;
  caption: string;
}
```

2. Estender a interface `Post` (depois de `track_name`):

```ts
  /** Preenchido pelo M4: todas as variações geradas (a 1ª sempre espelha headline/caption). */
  copy_variations: CopyVariation[] | null;
  /** Preenchido pelo M4 quando a geração de IA falha — nunca falha em silêncio. */
  copy_generation_error: string | null;
```

3. Verificação: `npx tsc --noEmit` (vai reclamar em qualquer lugar que faça `insert`/`select` estrito de `Post` sem esses campos — não deve haver, já que os inserts atuais usam objetos parciais).
4. Commit:

```bash
git add lib/types/post.ts
git commit -m "feat(types): adiciona CopyVariation e campos de IA em Post"
```

---

### Task 4: Cliente da OpenAI isolado

**Files:**
- Create: `lib/openai/client.ts`

**Passos:**

1. Criar `lib/openai/client.ts`:

```ts
import OpenAI from "openai";

/**
 * Cliente OpenAI isolado (mesmo princípio de camada isolada usado pro
 * Drive/Zernio) — trocar de provedor de IA no futuro fica restrito a este
 * arquivo e a `lib/openai/generateCopy.ts`.
 */
export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return new OpenAI({ apiKey });
}
```

2. Verificação: `npx tsc --noEmit`.
3. Commit:

```bash
git add lib/openai/client.ts
git commit -m "feat(openai): cliente isolado da OpenAI"
```

---

### Task 5: Prompt com o guia de estilo

**Files:**
- Create: `lib/openai/prompts.ts`

**Passos:**

1. Criar `lib/openai/prompts.ts`:

```ts
import type { PostType } from "@/lib/types/post";

/**
 * Regras do GUIA-DE-ESTILO-POSTS-PUZZLE.md traduzidas para o prompt da
 * IA. Duplicação intencional: o guia é a fonte de verdade pro time humano,
 * este texto é o que o modelo efetivamente lê em runtime.
 */
export const SYSTEM_PROMPT = `Você escreve manchetes e legendas para o Instagram do @puzzlerecordss, um perfil de mídia sobre funk e cultura pop (não institucional), no mesmo tom do @lovefunkprodutora.

Regras obrigatórias:
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
6. Se o tipo do post for "lancamento": a legenda é curta e direta, sempre menciona o artista com "@handle" e não repete a manchete.
7. Se o tipo do post for "viral_geral" ou "noticia_funk": a legenda segue 3 blocos — gancho em CAIXA ALTA com emojis, lide curto + pergunta de engajamento, fechamento opinativo/de torcida em CAIXA ALTA.

Responda SOMENTE em JSON válido, sem markdown, no formato exato:
{"variations": [{"headline": "...", "caption": "..."}, {"headline": "...", "caption": "..."}]}
Gere entre 2 e 3 variações plausíveis e diferentes entre si.`;

export function buildUserPrompt(input: {
  postType: PostType;
  fact: string;
  trackName: string | null;
  artistName: string | null;
  artistHandle: string | null;
}): string {
  const lines = [
    `Tipo de post: ${input.postType}`,
    `Fato/contexto: ${input.fact}`,
  ];
  if (input.trackName) lines.push(`Música: ${input.trackName}`);
  if (input.artistName) {
    lines.push(
      `Artista: ${input.artistName}${input.artistHandle ? ` (@${input.artistHandle})` : ""}`
    );
  }
  return lines.join("\n");
}
```

2. Verificação: `npx tsc --noEmit`.
3. Commit:

```bash
git add lib/openai/prompts.ts
git commit -m "feat(openai): prompt do sistema com o guia de estilo Puzzle Records"
```

---

### Task 6: Geração e validação das variações

**Files:**
- Create: `lib/openai/generateCopy.ts`

**Passos:**

1. Criar `lib/openai/generateCopy.ts`:

```ts
import { createOpenAIClient } from "./client";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompts";
import type { CopyVariation, PostType } from "@/lib/types/post";

const ROUTINE_MODEL = "gpt-4o-mini";
const LAUNCH_MODEL = "gpt-4o";

export class CopyGenerationError extends Error {}

function modelForPostType(postType: PostType): string {
  return postType === "lancamento" ? LAUNCH_MODEL : ROUTINE_MODEL;
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

/**
 * Gera 2-3 variações de manchete/legenda pro post. Lança CopyGenerationError
 * (ou erro do SDK da OpenAI) em caso de falha — quem chama decide como
 * registrar (ver app/api/cron/generate-copy/route.ts), nunca falha em
 * silêncio.
 */
export async function generateCopyVariations(input: {
  postType: PostType;
  fact: string;
  trackName: string | null;
  artistName: string | null;
  artistHandle: string | null;
}): Promise<CopyVariation[]> {
  const client = createOpenAIClient();
  const model = modelForPostType(input.postType);

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new CopyGenerationError("OpenAI retornou resposta vazia.");
  }

  return parseVariations(content);
}
```

2. Verificação: `npx tsc --noEmit` + `npm run lint`.
3. Commit:

```bash
git add lib/openai/generateCopy.ts
git commit -m "feat(openai): geração e validação de variações de manchete/legenda"
```

---

### Task 7: Query dos posts pendentes de copy

**Files:**
- Create: `lib/posts/pendingCopy.ts`

**Passos:**

1. Criar `lib/posts/pendingCopy.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostType } from "@/lib/types/post";

export interface PostPendingCopy {
  id: string;
  post_type: PostType;
  source_fact: string;
  track_name: string | null;
  artist: { name: string; handle: string } | null;
}

/**
 * Posts que ainda não têm manchete/legenda e nunca falharam ao gerar
 * (copy_generation_error é null) — isso é o que dá idempotência ao cron
 * do M4 sem precisar de uma tabela de auditoria à parte.
 */
export async function listPostsPendingCopy(
  supabase: SupabaseClient
): Promise<PostPendingCopy[]> {
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, post_type, source_fact, track_name, artist:artists(name, handle)"
    )
    .eq("status", "pendente")
    .is("headline", null)
    .is("copy_generation_error", null);

  if (error) {
    console.error("Falha ao listar posts pendentes de manchete/legenda:", error);
    return [];
  }

  return (data as unknown as PostPendingCopy[]) ?? [];
}
```

2. Verificação: `npx tsc --noEmit` + `npm run lint`.
3. Commit:

```bash
git add lib/posts/pendingCopy.ts
git commit -m "feat(posts): query de posts pendentes de manchete/legenda"
```

---

### Task 8: Cron `/api/cron/generate-copy`

**Files:**
- Create: `app/api/cron/generate-copy/route.ts`
- Modify: `vercel.json`

**Passos:**

1. Criar `app/api/cron/generate-copy/route.ts`:

```ts
import { NextResponse } from "next/server";

import {
  CopyGenerationError,
  generateCopyVariations,
} from "@/lib/openai/generateCopy";
import { listPostsPendingCopy } from "@/lib/posts/pendingCopy";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const posts = await listPostsPendingCopy(supabase);

  let generated = 0;
  for (const post of posts) {
    try {
      const variations = await generateCopyVariations({
        postType: post.post_type,
        fact: post.source_fact,
        trackName: post.track_name,
        artistName: post.artist?.name ?? null,
        artistHandle: post.artist?.handle ?? null,
      });

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
      await supabase
        .from("posts")
        .update({ copy_generation_error: message })
        .eq("id", post.id);
    }
  }

  return NextResponse.json({ generated, total: posts.length });
}
```

2. Editar `vercel.json` adicionando o segundo cron:

```json
{
  "crons": [
    { "path": "/api/cron/drive-ingest", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/generate-copy", "schedule": "*/5 * * * *" }
  ]
}
```

3. Verificação: `npx tsc --noEmit` + `npm run lint`.
4. Commit:

```bash
git add app/api/cron/generate-copy/route.ts vercel.json
git commit -m "feat(cron): gera manchete/legenda via OpenAI para posts pendentes"
```

---

### Task 9: Server action para trocar de variação

**Files:**
- Modify: `lib/posts/actions.ts`

**Passos:**

1. Adicionar em `lib/posts/actions.ts` (perto das outras actions de mudança de status), importando `CopyVariation` de `@/lib/types/post`:

```ts
export async function selectCopyVariation(
  postId: string,
  index: number,
  _formData: FormData
) {
  const supabase = await createClient();
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("copy_variations")
    .eq("id", postId)
    .single();

  const variations = post?.copy_variations as CopyVariation[] | null;
  const variation = variations?.[index];
  if (fetchError || !variation) {
    console.error(
      "Falha ao trocar variação de copy (post ou índice inválido):",
      postId,
      index,
      fetchError
    );
    return;
  }

  const { error } = await supabase
    .from("posts")
    .update({ headline: variation.headline, caption: variation.caption })
    .eq("id", postId);

  if (error) {
    console.error("Falha ao aplicar variação selecionada:", postId, error);
    return;
  }

  revalidatePostPages();
}
```

2. Verificação: `npx tsc --noEmit` + `npm run lint`.
3. Commit:

```bash
git add lib/posts/actions.ts
git commit -m "feat(posts): action para selecionar variação de manchete/legenda"
```

---

### Task 10: Picker de variações no Kanban

**Files:**
- Modify: `components/kanban/post-card.tsx`

**Passos:**

1. Importar `selectCopyVariation` junto das outras actions.
2. Adicionar, logo abaixo do bloco de `headline`/`caption` (depois da linha 99, antes do bloco de conta social/artista):

```tsx
{post.copy_variations && post.copy_variations.length > 1 && (
  <div className="flex flex-wrap gap-1">
    {post.copy_variations.map((variation, index) => (
      <form key={index} action={selectCopyVariation.bind(null, post.id, index)}>
        <Button
          type="submit"
          size="sm"
          variant={variation.headline === post.headline ? "default" : "outline"}
        >
          Variação {index + 1}
        </Button>
      </form>
    ))}
  </div>
)}
```

3. Adicionar, junto ao bloco de `ingestion_warning` (depois da linha 122):

```tsx
{post.copy_generation_error && (
  <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
    Erro ao gerar manchete/legenda: {post.copy_generation_error}
  </p>
)}
```

4. O picker fica visível pra qualquer papel que veja o card (troca de variação não é uma decisão de aprovação, é só facilitar a escolha antes de enviar pra fila — igual a editar manchete/legenda já é permitido via `PostFormDialog`). Não restringir por `canEdit` aqui evita duplicar a lógica de permissão; a escrita real já é protegida por RLS no Supabase.
5. Verificação: `npx tsc --noEmit` + `npm run lint`.
6. Rodar `npm run dev` e abrir `/conteudo` (ou onde o Kanban é montado) pra conferir visualmente que nada quebrou no card mesmo sem `copy_variations` (posts antigos do M2/M3 têm essa coluna `null`).
7. Commit:

```bash
git add components/kanban/post-card.tsx
git commit -m "feat(kanban): picker de variações e aviso de erro de geração de IA"
```

---

### Task 11: Checklist de teste manual ponta a ponta

**Objetivo:** validar com uma chave OpenAI real que o cron gera variações plausíveis e que falhas aparecem na fila em vez de sumir.

**Pré-requisitos:**
- Migration `0004_ai_copy.sql` aplicada no projeto Supabase linkado (`supabase db push` ou via dashboard).
- `OPENAI_API_KEY` configurada em `.env.local` (dev) e nas env vars da Vercel (produção).
- Pelo menos um post com `status = 'pendente'` e `headline is null` no banco (criar via ingestão real do Drive, M3, ou inserir um registro de teste direto no Supabase).

**Passos:**

1. Rodar `npm run dev`.
2. Chamar a rota do cron localmente simulando o header que a Vercel injeta:
   `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/generate-copy`
3. Conferir a resposta JSON (`{ generated, total }`) e no painel (`/conteudo` ou onde o Kanban roda) que o post pendente agora mostra manchete/legenda no lugar de "Aguardando manchete da IA (M4)".
4. Verificar no Supabase que `copy_variations` tem 2–3 itens e que `headline`/`caption` batem com o primeiro item.
5. Clicar num botão "Variação 2" (ou 3) no card e confirmar que `headline`/`caption` mudam pro conteúdo daquela variação, tanto na tela quanto no banco.
6. Testar o caminho de erro: trocar `OPENAI_API_KEY` por um valor inválido, criar/usar outro post pendente, rodar o cron de novo e confirmar que `copy_generation_error` aparece no card (sem quebrar a resposta do cron nem travar os outros posts) — depois restaurar a chave válida.
7. Conferir que um post de `post_type = 'lancamento'` gera legenda com `@handle` do artista e não repete a manchete (regra 6 do prompt).
8. Marcar em `PLAN.md` o M4 como "código pronto, checklist manual pendente/feito" conforme o padrão dos milestones anteriores, atualizando a seção correspondente.

---
