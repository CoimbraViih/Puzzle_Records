# M5 — Gerador de news cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para implementar este plano task por task, disparando um subagente novo por task com uma passada de code-reviewer entre tasks.

**Goal:** dado um post com `headline` já gerada (M4) e mídia do tipo imagem já enviada (M2/M3), o sistema renderiza automaticamente a arte final "news card" (Template A — faixa branca, ou Template B — manchete sobre imagem) e disponibiliza o resultado como preview no Kanban, sem publicar nada (a Regra de Ouro do `docs/CLAUDE.md` continua intocada — M5 só produz a imagem, M6/M7 cuidam de aprovação/publicação).

**Architecture:** um cron da Vercel a cada 5 minutos (`app/api/cron/generate-art`, mesmo padrão de `generate-copy`/`drive-ingest`) busca posts com `headline`/`template` preenchidos e `rendered_art_url`/`art_generation_error` ainda nulos. Para cada um, `lib/renderer/renderArt.ts` baixa a mídia original do bucket privado `posts-media` via URL assinada, monta a árvore de elementos do template escolhido (`lib/renderer/templates/templateA.tsx` ou `templateB.tsx`) e usa **Satori** para gerar SVG e **`@resvg/resvg-js`** para rasterizar em PNG — a dupla usada pelo `@vercel/og`, muito mais leve que Puppeteer/Chromium em função serverless da Vercel (decisão explícita: o `docs/CLAUDE.md` deixa "Puppeteer ou Satori" em aberto; Satori é a escolha recomendada aqui). O PNG resultante sobe para o mesmo bucket `posts-media` (mesma convenção de path `${uuid}.png` usada pela mídia original) e o path é gravado em `posts.rendered_art_url` (novo, migration `0005`). Falha em qualquer etapa grava `art_generation_error` no post e nunca falha em silêncio, replicando exatamente o padrão de `copy_generation_error` do M4. Uma ação de servidor `regenerateArt` permite ao admin/equipe forçar a regeração pelo Kanban sem esperar o cron (ex.: depois de trocar o template ou a variação de manchete escolhida).

**Tech Stack:** Satori (`satori`) + `@resvg/resvg-js` para render HTML-like → PNG, reaproveitando Next.js 16 App Router, Supabase Storage (bucket `posts-media`, já existente, privado, URLs assinadas), Vercel Cron (mesmo `CRON_SECRET`). Sem framework de testes automatizado no projeto (mesma situação do M1–M4) — cada task usa `npx tsc --noEmit` (+ `npm run lint` quando tocar em componentes/rotas) como verificação. A task final é um checklist de teste manual ponta a ponta.

**Decisões assumidas (sem contradição direta na documentação-fonte, registradas aqui para rastreabilidade):**
- Dimensão do card: **1080×1350px** (retrato 4:5, o formato de feed do Instagram que ocupa mais tela — a especificação não fixa um tamanho).
- Cor de marca `#96DB12` usada só como acento pontual (texto do rodapé do Template B); os templates seguem preto/branco como o guia de estilo descreve para o corpo da arte.
- Fontes: **Inter Bold** (Template A, manchete normal-case) e **Anton** (Template B, caixa alta condensada) — ambas Google Fonts licença OFL, baixadas como arquivos estáticos em `lib/renderer/fonts/`.
- Escopo v1: só posts com `media_type = 'image'`. Vídeo grava `art_generation_error` explicando a limitação (evita over-engineering de extração de frame de vídeo antes de haver demanda real).
- Logo: `puzzle-records-logo.svg` (hoje solto na raiz do repo) é lido em base64 e embutido como `data:image/svg+xml;base64,...` na árvore do Satori — não depende de leitura de arquivo em runtime além do bundle da função.

---

### Task 0: Checar particularidades do Next.js 16 antes de mexer em bundling de assets

**Objetivo:** o `AGENTS.md` do repo avisa que esta versão do Next.js tem breaking changes vs. conhecimento de treinamento. As tasks 1 e 5 dependem de garantir que `lib/renderer/fonts/*.ttf` e `puzzle-records-logo.svg` sejam incluídos no bundle da função serverless (senão o cron falha em produção mesmo passando localmente).

**Passos:**
1. Ler `node_modules/next/dist/docs/` procurando a chave de config atual para tracing de arquivos extra no App Router (histórico: `experimental.outputFileTracingIncludes`, pode ter mudado de posição/nome no Next 16).
2. Anotar o nome exato da chave encontrada — vai ser usada na Task 1, Passo 4.

Não commitar nada nesta task — é só pesquisa para não escrever config errada de cara.

---

### Task 1: Instalar dependências de render e baixar as fontes

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`
- Create: `lib/renderer/fonts/Inter-Bold.ttf`
- Create: `lib/renderer/fonts/Anton-Regular.ttf`

**Passos:**

1. Instalar as libs de render:
```bash
npm install satori @resvg/resvg-js
```

2. Baixar as fontes (Google Fonts, licença OFL, uso comercial permitido):
```bash
mkdir -p lib/renderer/fonts
curl -L -o lib/renderer/fonts/Inter-Bold.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/static/Inter-Bold.ttf"
curl -L -o lib/renderer/fonts/Anton-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf"
```
Se os paths do mirror `google/fonts` tiverem mudado, buscar o arquivo `.ttf` estático correspondente em https://fonts.google.com/specimen/Inter (peso 700) e https://fonts.google.com/specimen/Anton e baixar manualmente para o mesmo destino.

3. Confirmar que os dois arquivos não estão vazios/corrompidos:
```bash
file lib/renderer/fonts/Inter-Bold.ttf lib/renderer/fonts/Anton-Regular.ttf
```
Esperado: `TrueType Font data` (ou similar) para os dois.

4. Editar `next.config.ts` para: (a) marcar `@resvg/resvg-js` como pacote externo de servidor (binário nativo, não deve ser bundlado pelo webpack/turbopack), usando a chave correta de `serverExternalPackages` do Next 16; (b) garantir que `lib/renderer/fonts/**` e `puzzle-records-logo.svg` entrem no bundle da função via a chave de tracing identificada na Task 0. Exemplo de forma (ajustar nomes de chave conforme a doc lida na Task 0):
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    "/api/cron/generate-art": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
  },
};

export default nextConfig;
```

5. Verificar tipos:
```bash
npx tsc --noEmit
```
Esperado: sem erros novos.

6. Commit:
```bash
git add package.json package-lock.json next.config.ts lib/renderer/fonts
git commit -m "chore(renderer): adiciona satori, resvg e fontes para geração de news cards"
```

---

### Task 2: Migration — colunas de arte gerada

**Files:**
- Create: `supabase/migrations/0005_news_card_render.sql`

**Passos:**

1. Criar a migration seguindo o padrão minimalista do `0004_ai_copy.sql` (mesma dupla dado/erro que `copy_variations`/`copy_generation_error`):
```sql
-- 0005_news_card_render.sql
alter table public.posts
  add column rendered_art_url text,
  add column art_generation_error text;

comment on column public.posts.rendered_art_url is 'Path no bucket posts-media da arte PNG renderizada (Template A ou B), não URL completa.';
comment on column public.posts.art_generation_error is 'Mensagem de erro da última tentativa de geração de arte, nunca falha em silêncio (mesmo padrão de copy_generation_error).';
```
Nenhuma policy de RLS nova é necessária — as políticas existentes de `posts` já cobrem update/select em todas as colunas da tabela.

2. Aplicar a migration localmente se houver um projeto Supabase linkado (`supabase db push` ou equivalente já usado nas tasks anteriores do M2–M4); se não houver projeto linkado nesta sessão, deixar para o checklist manual final (Task 12), igual ao que M1–M4 já fizeram.

3. Commit:
```bash
git add supabase/migrations/0005_news_card_render.sql
git commit -m "feat(db): adiciona colunas de arte renderizada em posts"
```

---

### Task 3: `lib/renderer/client.ts` — fontes e logo em memória

**Files:**
- Create: `lib/renderer/client.ts`

**Passos:**

1. Criar o helper isolado de carregamento de assets (mesmo princípio de `lib/openai/client.ts`: uma função pequena, isolada, que lança erro explícito se algo estiver faltando):
```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface RenderFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let cachedFonts: RenderFont[] | null = null;
let cachedLogoDataUri: string | null = null;

export async function loadFonts(): Promise<RenderFont[]> {
  if (cachedFonts) return cachedFonts;

  const fontsDir = path.join(process.cwd(), "lib/renderer/fonts");
  const [interBold, antonRegular] = await Promise.all([
    readFile(path.join(fontsDir, "Inter-Bold.ttf")),
    readFile(path.join(fontsDir, "Anton-Regular.ttf")),
  ]);

  cachedFonts = [
    { name: "Inter", data: interBold, weight: 700, style: "normal" },
    { name: "Anton", data: antonRegular, weight: 400, style: "normal" },
  ];
  return cachedFonts;
}

export async function loadLogoDataUri(): Promise<string> {
  if (cachedLogoDataUri) return cachedLogoDataUri;

  const svgPath = path.join(process.cwd(), "puzzle-records-logo.svg");
  const svg = await readFile(svgPath, "utf-8");
  cachedLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return cachedLogoDataUri;
}
```

2. Verificar tipos:
```bash
npx tsc --noEmit
```

3. Commit:
```bash
git add lib/renderer/client.ts
git commit -m "feat(renderer): carrega fontes e logo para o Satori"
```

---

### Task 4: `lib/renderer/templates/templateA.tsx` — faixa branca

**Files:**
- Create: `lib/renderer/templates/templateA.tsx`

**Passos:**

1. Implementar a árvore de elementos do Template A conforme `GUIA-DE-ESTILO-POSTS-PUZZLE.md` (banner branco no topo com a manchete em normal-case, mídia abaixo, logo redondo sobrepondo a costura):
```tsx
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

interface TemplateAProps {
  headline: string;
  mediaDataUri: string;
  logoDataUri: string;
}

const BANNER_HEIGHT = Math.round(CARD_HEIGHT * 0.32);

export function templateA({ headline, mediaDataUri, logoDataUri }: TemplateAProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: CARD_WIDTH,
          height: BANNER_HEIGHT,
          padding: "0 64px",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 64,
            lineHeight: 1.15,
            color: "#111111",
          }}
        >
          {headline}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          position: "relative",
          width: CARD_WIDTH,
          height: CARD_HEIGHT - BANNER_HEIGHT,
        }}
      >
        <img
          src={mediaDataUri}
          style={{ width: CARD_WIDTH, height: CARD_HEIGHT - BANNER_HEIGHT, objectFit: "cover" }}
        />
        <img
          src={logoDataUri}
          style={{
            position: "absolute",
            top: -60,
            left: CARD_WIDTH / 2 - 60,
            width: 120,
            height: 120,
            borderRadius: 60,
            border: "6px solid #ffffff",
          }}
        />
      </div>
    </div>
  );
}
```

2. Verificar tipos:
```bash
npx tsc --noEmit
```

3. Commit:
```bash
git add lib/renderer/templates/templateA.tsx
git commit -m "feat(renderer): implementa template A (faixa branca)"
```

---

### Task 5: `lib/renderer/templates/templateB.tsx` — manchete sobre imagem

**Files:**
- Create: `lib/renderer/templates/templateB.tsx`

**Passos:**

1. Implementar o Template B (foto full-bleed, manchete em caixa alta na base, rodapé "SIGA @puzzlerecordss PARA VER MAIS", logo no canto):
```tsx
import { CARD_WIDTH, CARD_HEIGHT } from "./templateA";

interface TemplateBProps {
  headline: string;
  mediaDataUri: string;
  logoDataUri: string;
}

export function templateB({ headline, mediaDataUri, logoDataUri }: TemplateBProps) {
  return (
    <div style={{ display: "flex", position: "relative", width: CARD_WIDTH, height: CARD_HEIGHT }}>
      <img
        src={mediaDataUri}
        style={{ position: "absolute", top: 0, left: 0, width: CARD_WIDTH, height: CARD_HEIGHT, objectFit: "cover" }}
      />
      <img
        src={logoDataUri}
        style={{
          position: "absolute",
          top: 48,
          right: 48,
          width: 96,
          height: 96,
          borderRadius: 48,
          border: "4px solid #ffffff",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          display: "flex",
          flexDirection: "column",
          width: CARD_WIDTH,
          padding: "48px 56px 64px",
          background: "linear-gradient(to top, rgba(0,0,0,0.92) 20%, rgba(0,0,0,0) 100%)",
        }}
      >
        <span
          style={{
            fontFamily: "Anton",
            fontWeight: 400,
            fontSize: 72,
            lineHeight: 1.05,
            color: "#ffffff",
            textTransform: "uppercase",
          }}
        >
          {headline}
        </span>
        <span style={{ marginTop: 24, fontFamily: "Inter", fontWeight: 700, fontSize: 28, color: "#96DB12" }}>
          SIGA @puzzlerecordss PARA VER MAIS
        </span>
      </div>
    </div>
  );
}
```

2. Verificar tipos:
```bash
npx tsc --noEmit
```

3. Commit:
```bash
git add lib/renderer/templates/templateB.tsx
git commit -m "feat(renderer): implementa template B (manchete sobre imagem)"
```

---

### Task 6: `lib/renderer/renderArt.ts` — orquestração Satori → PNG → Storage

**Files:**
- Create: `lib/renderer/renderArt.ts`

**Passos:**

1. Implementar a função principal, seguindo o mesmo contrato de `lib/openai/generateCopy.ts` (classe de erro dedicada, uma função async principal, joga o erro para quem chama decidir como gravar):
```ts
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFonts, loadLogoDataUri } from "./client";
import { templateA, CARD_WIDTH, CARD_HEIGHT } from "./templates/templateA";
import { templateB } from "./templates/templateB";

export class ArtRenderError extends Error {}

interface RenderArtInput {
  postId: string;
  template: "A" | "B";
  headline: string;
  mediaUrl: string;
  mediaType: "image" | "video";
}

/**
 * Renderiza a arte final do post e sobe o PNG para o bucket posts-media.
 * Lança ArtRenderError em qualquer falha — quem chama decide como registrar.
 * Retorna o path (não a URL completa) do PNG gerado no Storage.
 */
export async function renderArt(input: RenderArtInput): Promise<string> {
  if (input.mediaType !== "image") {
    throw new ArtRenderError(
      "Renderização de arte só é suportada para mídia do tipo imagem por enquanto."
    );
  }

  const supabase = createServiceClient();

  const { data: signedUrlData, error: signError } = await supabase.storage
    .from("posts-media")
    .createSignedUrl(input.mediaUrl, 60);
  if (signError || !signedUrlData) {
    throw new ArtRenderError(
      `Não foi possível gerar URL assinada da mídia original: ${signError?.message ?? "desconhecido"}`
    );
  }

  const mediaResponse = await fetch(signedUrlData.signedUrl);
  if (!mediaResponse.ok) {
    throw new ArtRenderError(`Falha ao baixar a mídia original (status ${mediaResponse.status}).`);
  }
  const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
  const mediaContentType = mediaResponse.headers.get("content-type") ?? "image/jpeg";
  const mediaDataUri = `data:${mediaContentType};base64,${mediaBuffer.toString("base64")}`;

  const [fonts, logoDataUri] = await Promise.all([loadFonts(), loadLogoDataUri()]);

  const element =
    input.template === "A"
      ? templateA({ headline: input.headline, mediaDataUri, logoDataUri })
      : templateB({ headline: input.headline, mediaDataUri, logoDataUri });

  let svg: string;
  try {
    svg = await satori(element, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts });
  } catch (err) {
    throw new ArtRenderError(
      `Falha ao montar o SVG da arte: ${err instanceof Error ? err.message : "erro desconhecido"}`
    );
  }

  const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng();

  const artPath = `art-${input.postId}-${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from("posts-media")
    .upload(artPath, png, { contentType: "image/png", upsert: false });
  if (uploadError) {
    throw new ArtRenderError(`Falha ao subir a arte gerada para o Storage: ${uploadError.message}`);
  }

  return artPath;
}
```

2. Verificar tipos:
```bash
npx tsc --noEmit
```

3. Commit:
```bash
git add lib/renderer/renderArt.ts
git commit -m "feat(renderer): orquestra render Satori -> PNG -> Storage"
```

---

### Task 7: `lib/posts/pendingArt.ts` — fila de posts pendentes de arte

**Files:**
- Create: `lib/posts/pendingArt.ts`

**Passos:**

1. Implementar a query, seguindo exatamente o padrão de `lib/posts/pendingCopy.ts` do M4 (nunca lança, loga e retorna `[]` em erro):
```ts
import { createServiceClient } from "@/lib/supabase/service";

export interface PostPendingArt {
  id: string;
  template: "A" | "B";
  headline: string;
  media_url: string;
  media_type: "image" | "video";
}

export async function listPostsPendingArt(): Promise<PostPendingArt[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id, template, headline, media_url, media_type")
    .not("headline", "is", null)
    .not("template", "is", null)
    .is("rendered_art_url", null)
    .is("art_generation_error", null);

  if (error) {
    console.error("[pendingArt] falha ao buscar posts pendentes de arte:", error.message);
    return [];
  }

  return (data ?? []) as PostPendingArt[];
}
```

2. Verificar tipos:
```bash
npx tsc --noEmit
```

3. Commit:
```bash
git add lib/posts/pendingArt.ts
git commit -m "feat(posts): query de posts pendentes de geração de arte"
```

---

### Task 8: Cron `app/api/cron/generate-art/route.ts`

**Files:**
- Create: `app/api/cron/generate-art/route.ts`
- Modify: `vercel.json`

**Passos:**

1. Criar a rota, replicando a estrutura de `app/api/cron/generate-copy/route.ts` (mesma checagem de `CRON_SECRET`, mesmo padrão de gravar erro por item sem interromper o loop):
```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listPostsPendingArt } from "@/lib/posts/pendingArt";
import { renderArt, ArtRenderError } from "@/lib/renderer/renderArt";

function isAuthorized(request: Request) {
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

async function recordArtError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ art_generation_error: message })
    .eq("id", postId);
  if (error) {
    console.error(`[generate-art] falha ao gravar art_generation_error do post ${postId}:`, error.message);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pending = await listPostsPendingArt();
  const supabase = createServiceClient();
  let generated = 0;

  for (const post of pending) {
    try {
      const artPath = await renderArt({
        postId: post.id,
        template: post.template,
        headline: post.headline,
        mediaUrl: post.media_url,
        mediaType: post.media_type,
      });

      const { error } = await supabase
        .from("posts")
        .update({ rendered_art_url: artPath })
        .eq("id", post.id);

      if (error) {
        console.error(`[generate-art] falha ao gravar rendered_art_url do post ${post.id}:`, error.message);
        continue;
      }
      generated += 1;
    } catch (err) {
      const message = err instanceof ArtRenderError ? err.message : "Erro inesperado ao gerar a arte.";
      await recordArtError(post.id, message);
    }
  }

  return NextResponse.json({ generated, total: pending.length });
}
```

2. Adicionar o cron em `vercel.json`, ao lado dos dois já existentes (`drive-ingest`, `generate-copy`), mesma cadência de 5 minutos:
```json
{ "path": "/api/cron/generate-art", "schedule": "*/5 * * * *" }
```

3. Verificar tipos e lint:
```bash
npx tsc --noEmit
npm run lint
```

4. Commit:
```bash
git add app/api/cron/generate-art/route.ts vercel.json
git commit -m "feat(cron): gera arte automaticamente para posts com manchete pronta"
```

---

### Task 9: URL assinada da arte em `lib/posts/queries.ts`

**Files:**
- Modify: `lib/posts/queries.ts`

**Passos:**

1. Localizar o bloco de `listPosts()` que já gera `media_signed_url` via `createSignedUrls` em lote e estender para incluir também os paths de `rendered_art_url` não nulos na mesma chamada em lote (evita uma segunda ida ao Storage por post), expondo `rendered_art_signed_url` no objeto de post retornado (`null` quando `rendered_art_url` for `null`).

2. Atualizar o tipo de post retornado por `queries.ts` (onde quer que `media_signed_url` esteja tipado hoje) para incluir `rendered_art_signed_url: string | null`.

3. Verificar tipos:
```bash
npx tsc --noEmit
```

4. Commit:
```bash
git add lib/posts/queries.ts
git commit -m "feat(posts): expõe URL assinada da arte renderizada nas queries"
```

---

### Task 10: Server action `regenerateArt` em `lib/posts/actions.ts`

**Files:**
- Modify: `lib/posts/actions.ts`

**Passos:**

1. Adicionar uma action que renderiza a arte na hora (não só limpa colunas e espera o cron — feedback imediato para quem está no painel), seguindo o mesmo padrão de autenticação/autorização e de checagem de zero linhas afetadas já usado por `selectCopyVariation`/`updatePost` no arquivo:
```ts
export async function regenerateArt(postId: string) {
  // reaproveitar aqui o mesmo helper de auth/role check usado por selectCopyVariation
  // (ex.: requireContentTeamOrAdmin() ou equivalente já existente no arquivo)

  const supabase = await createServerClient();
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("id, template, headline, media_url, media_type")
    .eq("id", postId)
    .single();

  if (fetchError || !post || !post.template || !post.headline) {
    console.error(`[regenerateArt] post ${postId} sem template/headline prontos:`, fetchError?.message);
    return;
  }

  try {
    const { renderArt } = await import("@/lib/renderer/renderArt");
    const artPath = await renderArt({
      postId: post.id,
      template: post.template as "A" | "B",
      headline: post.headline,
      mediaUrl: post.media_url,
      mediaType: post.media_type as "image" | "video",
    });

    const { error, count } = await supabase
      .from("posts")
      .update({ rendered_art_url: artPath, art_generation_error: null })
      .eq("id", postId)
      .select("id", { count: "exact" });

    if (error || !count) {
      console.error(`[regenerateArt] escrita bloqueada ou falhou para o post ${postId}:`, error?.message);
      return;
    }
  } catch (err) {
    const { ArtRenderError } = await import("@/lib/renderer/renderArt");
    const message = err instanceof ArtRenderError ? err.message : "Erro inesperado ao gerar a arte.";
    const { error } = await supabase
      .from("posts")
      .update({ art_generation_error: message })
      .eq("id", postId);
    if (error) {
      console.error(`[regenerateArt] falha ao gravar art_generation_error do post ${postId}:`, error.message);
    }
  }

  revalidatePostPages();
}
```
Ajustar o import/checagem de permissão e o helper de detecção de zero linhas afetadas para usar exatamente o que já existe no arquivo (não inventar um novo padrão — olhar `selectCopyVariation` linha a linha antes de escrever isso).

2. Verificar tipos:
```bash
npx tsc --noEmit
```

3. Commit:
```bash
git add lib/posts/actions.ts
git commit -m "feat(posts): action para regenerar arte sob demanda pelo Kanban"
```

---

### Task 11: Preview de arte e erro no Kanban (`post-card.tsx`)

**Files:**
- Modify: `components/kanban/post-card.tsx`

**Passos:**

1. Logo após o bloco existente de preview de mídia (`<img>`/`<video>` com `post.media_signed_url`), adicionar um bloco condicional mostrando a arte renderizada quando existir:
```tsx
{post.rendered_art_signed_url && (
  <img
    src={post.rendered_art_signed_url}
    alt="Arte gerada"
    className="mt-2 w-full rounded-md border"
  />
)}
```

2. Replicar o padrão visual já usado para `copy_generation_error`/`ingestion_warning` (bloco `bg-destructive/10 text-destructive`) para `art_generation_error`:
```tsx
{post.art_generation_error && (
  <p className="mt-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
    Falha ao gerar arte: {post.art_generation_error}
  </p>
)}
```

3. Adicionar o botão "Gerar arte" / "Regenerar arte", no mesmo formato de `<form action={...}>` por botão usado pelo picker de variações de copy:
```tsx
{post.headline && post.template && (
  <form action={regenerateArt.bind(null, post.id)}>
    <Button type="submit" size="sm" variant="outline">
      {post.rendered_art_url ? "Regenerar arte" : "Gerar arte"}
    </Button>
  </form>
)}
```
Importar `regenerateArt` de `@/lib/posts/actions`.

4. Verificar tipos e lint:
```bash
npx tsc --noEmit
npm run lint
```

5. Commit:
```bash
git add components/kanban/post-card.tsx
git commit -m "feat(kanban): preview e regeração manual da arte no card do post"
```

---

### Task 12: Checklist manual ponta a ponta + atualizar `PLAN.md`

**Objetivo:** validar o M5 contra um projeto Supabase linkado de verdade, com um post real que já tenha manchete (saído do M4).

**Pré-requisitos:**
- Migration `0005_news_card_render.sql` aplicada.
- Variáveis de ambiente de Storage/Supabase já configuradas (mesmas do M2–M4).
- Um post no Kanban com `status` em qualquer coluna, `headline`/`template` preenchidos e `media_type = 'image'`.

**Passos:**
1. Rodar `npm run build` local para confirmar que o bundle inclui as fontes/logo sem erro de `ENOENT` em runtime (ou rodar `next dev` e chamar a rota do cron manualmente).
2. Chamar `GET /api/cron/generate-art` com o header `Authorization: Bearer $CRON_SECRET` contra o post de teste.
3. Confirmar no painel que `rendered_art_url` foi preenchido e o preview aparece no card do Kanban, para os dois templates (criar/editar um segundo post de teste trocando `template` para "B").
4. Forçar um erro proposital (ex.: apontar `media_url` para um path inexistente) e confirmar que `art_generation_error` aparece na fila em vez de o post travar silenciosamente.
5. Clicar em "Regenerar arte" pelo painel e confirmar que a arte é atualizada sem esperar o cron.
6. Atualizar a seção `## M5 — Gerador de news cards` do `PLAN.md`: marcar os itens como `[x]`, anotar "código pronto, checklist manual pendente/concluído" conforme o resultado real deste passo, no mesmo formato usado pelo M1–M4.
7. Commit:
```bash
git add PLAN.md
git commit -m "docs: marcar M5 como código pronto, checklist manual pendente"
```
