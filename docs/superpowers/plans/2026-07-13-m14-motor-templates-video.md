# M14 — Motor e página de templates de vídeo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a lacuna de vídeo do M5 (hoje `renderArt.ts` lança erro explícito para `mediaType === "video"`) com um motor de templates próprio (Remotion + Whisper com timestamps por palavra + FFmpeg), um worker de render fora da Vercel (Railway) chamado de forma assíncrona e idempotente pelo painel, e uma página `/templates` para escolher/customizar o template aplicado.

**Architecture:** O render pesado roda num serviço Node separado (`render-worker/`, deployado no Railway, fora deste app Next.js) que expõe `POST /render` (aceita o job e responde na hora com um `jobId`) e `GET /render/:jobId` (status). O painel Next.js nunca renderiza vídeo — só orquestra: um cron submete jobs pendentes (idempotente, nunca resubmete um job já registrado), outro cron faz *polling* do worker e baixa o MP4 pronto pro Storage. Esse padrão espelha o `onSubmitted`/`resolvePendingPublish` já usado em `lib/publishing/zernio.ts`. Um template é uma linha da tabela `templates` (JSON de config), resolvida em props React consumidas pela composição Remotion — mesmo espírito de `lib/renderer/templates/templateA.tsx` (JSON/props → elemento visual), só que em vídeo.

**Tech Stack:** Remotion 4.x (`remotion`, `@remotion/cli`, `@remotion/renderer`) no `render-worker/`; Whisper API (`openai` SDK, já em uso) com `timestamp_granularities: ["word"]`; Express no worker; Supabase Postgres/Storage (já em uso); Next.js 16 App Router (já em uso).

## Global Constraints

- **Nenhum post é publicado sem aprovação humana** (regra de ouro do `docs/CLAUDE.md`) — o vídeo renderizado só alimenta `rendered_art_url` para preview na fila; não toca em `status` do post nem em publicação.
- **Identidade visual**: verde-limão `#96DB12` sobre preto/branco, conforme `docs/CLAUDE.md` e seção 6 do `ANATOMIA-TEMPLATES-VIDEO.md`.
- **Template inicial "Puzzle v1"** (anatomia exata, `ANATOMIA-TEMPLATES-VIDEO.md` seção 6): formato 9:16, caixa de título verde-limão `#96DB12` com texto preto caps no terço inferior (0–3s), legendas estilo "viral" (palavra destacada em verde, fonte bold sem serifa), logo Puzzle pequena no canto superior direito, barra de progresso fina verde na base, sem música adicional, rodapé "SIGA @puzzlerecordss" opcional (desligado por padrão).
- **Repositório de templates = tabela `templates` no Supabase** com JSON de configuração (decisão de arquitetura já fechada em `docs/CLAUDE.md` linha 57 — não é geração via IA nem Canva).
- **Sem hashtags, sem timeline visual no MVP** (`docs/CLAUDE.md` / `PLAN.md` M14) — a página `/templates` é galeria + formulário, não editor de timeline.
- **Convenção de migrations**: `supabase/migrations/NNNN_descricao_snake_case.sql`, 4 dígitos. Última existente: `0013_notifications.sql`. Esta plano usa `0014_video_templates.sql`.
- **Convenção de módulos `lib/`**: um `client.ts` por integração externa quando aplicável, funções de responsabilidade única, erros customizados exportados junto da função (`ArtRenderError`, `VideoAnalysisError` são o padrão — siga o mesmo nome `<Contexto>Error`).
- **Não há framework de testes automatizados no app Next.js principal** (nenhum `vitest`/`jest` no `package.json`, nenhum arquivo `*.test.*` no repo) — a verificação de cada task no app principal é `npx tsc --noEmit` + `npm run lint` + `npm run build`, não testes unitários. Não introduza um test runner no app principal só para este plano — siga a convenção existente. O `render-worker/` é um serviço novo e isolado (package.json próprio, fora do build do Next.js); para ele, e só para ele, este plano introduz `vitest` como dependência de dev, porque a lógica pura do gerenciador de jobs e do agrupamento de legendas por timestamp precisa de cobertura automatizada e não há Chromium/rede disponível no ambiente de execução dos subagents para rodar um render real do Remotion — isso fica para verificação manual do Victor, documentada em cada task como tal.
- **CRON_SECRET**: toda rota `app/api/cron/**` nova segue o padrão de autorização já usado em `generate-art/route.ts` (`Authorization: Bearer <CRON_SECRET>`).
- **Idempotência**: nenhuma rota de cron deve resubmeter um job de render já registrado (`video_render_job_id` preenchido) — só o cron de submissão grava esse campo; só o cron de polling o lê e nunca escreve nele de novo.

---

## Task 1: Migration — tabela `templates` + colunas de render em `posts`

**Files:**
- Create: `supabase/migrations/0014_video_templates.sql`

**Interfaces:**
- Produces: tabela `public.templates(id, name, config jsonb, format, is_default, created_at, updated_at)`; colunas novas em `public.posts`: `video_template_id uuid references templates(id)`, `video_render_job_id text`, `video_render_status text check (video_render_status in ('processing','done','error'))`. Uma linha seed com `is_default = true` e `name = 'Puzzle v1'`.

- [ ] **Step 1: Escrever a migration**

```sql
-- M14: repositório de templates de vídeo (tabela própria no Supabase, JSON
-- de configuração renderizado pelo motor Remotion do render-worker) +
-- colunas de acompanhamento do job assíncrono de render em posts. Ver
-- docs/CLAUDE.md (decisão de arquitetura, linha 57) e
-- ANATOMIA-TEMPLATES-VIDEO.md seção 6 (anatomia do template "Puzzle v1").

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  config jsonb not null,
  format text not null default '9:16',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

alter table public.templates enable row level security;

create policy "templates_select_authenticated"
  on public.templates for select
  using (auth.uid() is not null);

create policy "templates_admin_write"
  on public.templates for all
  using (public.is_admin())
  with check (public.is_admin());

-- Só um template pode ser o default por vez.
create unique index templates_single_default
  on public.templates ((is_default))
  where is_default;

alter table public.posts
  add column video_template_id uuid references public.templates (id),
  add column video_render_job_id text,
  add column video_render_status text
    check (video_render_status in ('processing', 'done', 'error'));

insert into public.templates (name, config, format, is_default)
values (
  'Puzzle v1',
  '{
    "titleBox": {
      "color": "#96DB12",
      "textColor": "#000000",
      "position": "bottom-third",
      "durationSeconds": 3
    },
    "captionStyle": "viral",
    "logo": { "enabled": true, "position": "top-right" },
    "progressBar": { "enabled": true, "color": "#96DB12" },
    "footer": { "enabled": false, "text": "SIGA @puzzlerecordss" }
  }'::jsonb,
  '9:16',
  true
);
```

- [ ] **Step 2: Verificar sintaxe**

Não há harness de migrations neste repo (convenção observada em `0001`–`0013`: sem testes automatizados, aplicação via Supabase CLI/dashboard fora do escopo do worktree). Verifique apenas que o arquivo foi salvo sem erro de encoding:

Run: `node -e "require('fs').readFileSync('supabase/migrations/0014_video_templates.sql','utf8')"`
Expected: nenhuma saída (sem exceção).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0014_video_templates.sql
git commit -m "feat(m14): migration da tabela templates + colunas de render de vídeo em posts"
```

---

## Task 2: Tipos + camada de leitura de templates

**Files:**
- Create: `lib/types/template.ts`
- Create: `lib/templates/queries.ts`
- Test: nenhum (sem test runner no app principal — verificação via `tsc`/`lint`, conforme Global Constraints)

**Interfaces:**
- Consumes: tabela `templates` da Task 1 (colunas `id, name, config, format, is_default, created_at, updated_at`).
- Produces: `VideoTemplateConfig`, `VideoTemplate` (tipos), `listVideoTemplates(): Promise<VideoTemplate[]>`, `getDefaultVideoTemplate(): Promise<VideoTemplate | null>` — usados pela Task 6 (cron de submissão) e Task 8 (página `/templates`).

- [ ] **Step 1: Criar os tipos**

`lib/types/template.ts`:

```ts
export const CAPTION_STYLES = ["viral", "classico", "karaoke"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const TITLE_BOX_POSITIONS = ["bottom-third", "top-third"] as const;
export type TitleBoxPosition = (typeof TITLE_BOX_POSITIONS)[number];

export const LOGO_POSITIONS = ["top-right", "top-left"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export interface VideoTemplateConfig {
  titleBox: {
    color: string;
    textColor: string;
    position: TitleBoxPosition;
    durationSeconds: number;
  };
  captionStyle: CaptionStyle;
  logo: { enabled: boolean; position: LogoPosition };
  progressBar: { enabled: boolean; color: string };
  footer: { enabled: boolean; text: string };
}

export interface VideoTemplate {
  id: string;
  name: string;
  config: VideoTemplateConfig;
  format: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Criar a camada de leitura**

`lib/templates/queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { VideoTemplate } from "@/lib/types/template";

export async function listVideoTemplates(): Promise<VideoTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Falha ao listar templates:", error);
    return [];
  }

  return (data as VideoTemplate[]) ?? [];
}

export async function getDefaultVideoTemplate(): Promise<VideoTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();

  if (error) {
    console.error("Falha ao buscar template default:", error);
    return null;
  }

  return (data as VideoTemplate) ?? null;
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos introduzidos por estes dois arquivos.

- [ ] **Step 4: Commit**

```bash
git add lib/types/template.ts lib/templates/queries.ts
git commit -m "feat(m14): tipos e camada de leitura da tabela templates"
```

---

## Task 3: Whisper com timestamps por palavra

**Files:**
- Modify: `lib/openai/videoAnalysis.ts`

**Interfaces:**
- Consumes: `createOpenAIClient()` de `lib/openai/client.ts` (já existe, sem mudança).
- Produces: `export interface WordTimestamp { word: string; start: number; end: number }`; `export async function transcribeWithWordTimestamps(videoBuffer: Buffer, filename: string): Promise<WordTimestamp[]>` (lança `VideoAnalysisError` se a chamada falhar — não engole silenciosamente, ao contrário de `transcribeAudio`, porque aqui a legenda sincronizada é o produto principal do render, não um complemento opcional). Consumida pela Task 6 (submissão do job) para montar o payload do worker.

- [ ] **Step 1: Adicionar a função com timestamps por palavra**

Adicione ao final de `lib/openai/videoAnalysis.ts` (mantendo tudo que já existe no arquivo):

```ts
export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface WhisperVerboseWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperVerboseResponse {
  words?: WhisperVerboseWord[];
}

/**
 * Transcreve com timestamp por palavra (necessário pra legenda estilo
 * karaokê/viral sincronizada). Ao contrário de transcribeAudio() (usada na
 * análise multimodal do M4/M11, onde a legenda é só um complemento e uma
 * falha não pode travar a geração de copy), aqui a transcrição é o insumo
 * principal da legenda renderizada — falha vira erro explícito.
 */
export async function transcribeWithWordTimestamps(
  videoBuffer: Buffer,
  filename: string
): Promise<WordTimestamp[]> {
  const client = createOpenAIClient();
  const file = new File([new Uint8Array(videoBuffer)], filename);

  let response: WhisperVerboseResponse;
  try {
    response = (await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    })) as unknown as WhisperVerboseResponse;
  } catch (err) {
    throw new VideoAnalysisError(
      `Falha ao transcrever áudio com timestamps por palavra: ${
        err instanceof Error ? err.message : "erro desconhecido"
      }`
    );
  }

  const words = response.words ?? [];
  if (words.length === 0) {
    throw new VideoAnalysisError(
      "Transcrição não retornou palavras com timestamp (vídeo sem áudio/fala detectável)."
    );
  }

  return words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. Confirme que `timestamp_granularities` é aceito pelo tipo `Uploadable`/params do SDK `openai@^6.45.0` instalado (`node_modules/openai/resources/audio/transcriptions.d.ts`); se o SDK não expuser esse campo no tipo, adicione `as never` só nesse ponto do payload (não no retorno) para não mascarar erros de tipo no resto da função — documente com um comentário de uma linha por que o cast é necessário.

- [ ] **Step 3: Commit**

```bash
git add lib/openai/videoAnalysis.ts
git commit -m "feat(m14): transcricao Whisper com timestamp por palavra para legendas sincronizadas"
```

---

## Task 4: `render-worker` — composição Remotion "Puzzle v1" + agrupamento de legendas

**Files:**
- Create: `render-worker/package.json`
- Create: `render-worker/tsconfig.json`
- Create: `render-worker/vitest.config.ts`
- Create: `render-worker/remotion/captions.ts`
- Create: `render-worker/remotion/captions.test.ts`
- Create: `render-worker/remotion/Root.tsx`
- Create: `render-worker/remotion/PuzzleTemplateV1.tsx`
- Create: `render-worker/remotion/index.ts`

**Interfaces:**
- Consumes: `WordTimestamp[]` no formato produzido pela Task 3 (`{ word, start, end }`, `start`/`end` em segundos).
- Produces: `groupWordsIntoCaptionLines(words: WordTimestamp[], maxWordsPerLine?: number): CaptionLine[]` (`CaptionLine = { words: WordTimestamp[]; startFrame: number; endFrame: number }`, a 30fps); composição Remotion `PuzzleTemplateV1` registrada em `render-worker/remotion/index.ts`, consumida pela Task 5 (`renderMedia` com `composition: "PuzzleTemplateV1"`).

- [ ] **Step 1: `render-worker/package.json`**

```json
{
  "name": "puzzle-render-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@remotion/renderer": "^4.0.290",
    "express": "^4.21.2",
    "remotion": "^4.0.290",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20",
    "@types/react": "^19",
    "tsx": "^4.19.2",
    "typescript": "^5",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: `render-worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "remotion"]
}
```

- [ ] **Step 3: `render-worker/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 4: Escrever o teste do agrupamento de legendas (falha primeiro)**

`render-worker/remotion/captions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupWordsIntoCaptionLines } from "./captions";

describe("groupWordsIntoCaptionLines", () => {
  it("agrupa palavras em linhas de até maxWordsPerLine, convertendo segundos para frames a 30fps", () => {
    const words = [
      { word: "vai", start: 0, end: 0.3 },
      { word: "dar", start: 0.3, end: 0.5 },
      { word: "onda", start: 0.5, end: 0.9 },
      { word: "hoje", start: 0.9, end: 1.2 },
    ];

    const lines = groupWordsIntoCaptionLines(words, 3);

    expect(lines).toHaveLength(2);
    expect(lines[0].words.map((w) => w.word)).toEqual(["vai", "dar", "onda"]);
    expect(lines[0].startFrame).toBe(0);
    expect(lines[0].endFrame).toBe(27); // 0.9s * 30fps
    expect(lines[1].words.map((w) => w.word)).toEqual(["hoje"]);
    expect(lines[1].startFrame).toBe(27);
    expect(lines[1].endFrame).toBe(36); // 1.2s * 30fps
  });

  it("retorna lista vazia para entrada vazia", () => {
    expect(groupWordsIntoCaptionLines([], 3)).toEqual([]);
  });

  it("usa 4 como maxWordsPerLine padrão quando não informado", () => {
    const words = Array.from({ length: 5 }, (_, i) => ({
      word: `p${i}`,
      start: i,
      end: i + 1,
    }));

    const lines = groupWordsIntoCaptionLines(words);

    expect(lines[0].words).toHaveLength(4);
    expect(lines[1].words).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Rodar e confirmar falha**

Run (dentro de `render-worker/`, após `npm install`): `npm test`
Expected: FAIL — `captions.ts` não existe / `groupWordsIntoCaptionLines is not defined`.

- [ ] **Step 6: Implementar `captions.ts`**

`render-worker/remotion/captions.ts`:

```ts
export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface CaptionLine {
  words: WordTimestamp[];
  startFrame: number;
  endFrame: number;
}

const FPS = 30;
const DEFAULT_MAX_WORDS_PER_LINE = 4;

function secondsToFrame(seconds: number): number {
  return Math.round(seconds * FPS);
}

/**
 * Agrupa palavras com timestamp em linhas de legenda de até
 * maxWordsPerLine palavras, convertendo os limites de tempo (segundos,
 * como vem do Whisper) para frames (30fps, taxa de render do worker).
 */
export function groupWordsIntoCaptionLines(
  words: WordTimestamp[],
  maxWordsPerLine: number = DEFAULT_MAX_WORDS_PER_LINE
): CaptionLine[] {
  const lines: CaptionLine[] = [];

  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    const chunk = words.slice(i, i + maxWordsPerLine);
    lines.push({
      words: chunk,
      startFrame: secondsToFrame(chunk[0].start),
      endFrame: secondsToFrame(chunk[chunk.length - 1].end),
    });
  }

  return lines;
}
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `npm test`
Expected: PASS (3/3).

- [ ] **Step 8: Composição Remotion**

`render-worker/remotion/PuzzleTemplateV1.tsx`:

```tsx
import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { groupWordsIntoCaptionLines, type WordTimestamp } from "./captions";
import type { VideoTemplateConfig } from "./templateConfig";

export interface PuzzleTemplateV1Props {
  videoUrl: string;
  headline: string;
  words: WordTimestamp[];
  config: VideoTemplateConfig;
  logoUrl: string;
  durationInFrames: number;
}

export function PuzzleTemplateV1({
  videoUrl,
  headline,
  words,
  config,
  logoUrl,
  durationInFrames,
}: PuzzleTemplateV1Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const captionLines = groupWordsIntoCaptionLines(words);
  const titleDurationFrames = Math.round(config.titleBox.durationSeconds * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <OffthreadVideo src={videoUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />

      {frame < titleDurationFrames && (
        <AbsoluteFill
          style={{
            justifyContent: config.titleBox.position === "bottom-third" ? "flex-end" : "flex-start",
            alignItems: "center",
            paddingBottom: config.titleBox.position === "bottom-third" ? 220 : 0,
            paddingTop: config.titleBox.position === "top-third" ? 220 : 0,
          }}
        >
          <div
            style={{
              backgroundColor: config.titleBox.color,
              color: config.titleBox.textColor,
              padding: "24px 40px",
              fontSize: 56,
              fontWeight: 800,
              textTransform: "uppercase",
              textAlign: "center",
              maxWidth: "90%",
            }}
          >
            {headline}
          </div>
        </AbsoluteFill>
      )}

      {captionLines.map((line, index) => (
        <Sequence key={index} from={line.startFrame} durationInFrames={line.endFrame - line.startFrame}>
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 100 }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#ffffff", textAlign: "center" }}>
              {line.words.map((w, i) => (
                <span
                  key={i}
                  style={{
                    color: config.captionStyle === "viral" ? config.progressBar.color : "#ffffff",
                    marginRight: 12,
                  }}
                >
                  {w.word}
                </span>
              ))}
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}

      {config.logo.enabled && (
        <Img
          src={logoUrl}
          style={{
            position: "absolute",
            top: 40,
            right: config.logo.position === "top-right" ? 40 : undefined,
            left: config.logo.position === "top-left" ? 40 : undefined,
            width: 90,
            height: 90,
          }}
        />
      )}

      {config.progressBar.enabled && (
        <AbsoluteFill style={{ justifyContent: "flex-end" }}>
          <div style={{ height: 6, backgroundColor: "rgba(255,255,255,0.2)", width: "100%" }}>
            <div
              style={{
                height: "100%",
                width: `${(frame / durationInFrames) * 100}%`,
                backgroundColor: config.progressBar.color,
              }}
            />
          </div>
        </AbsoluteFill>
      )}

      {config.footer.enabled && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 24 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ffffff" }}>{config.footer.text}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
```

`render-worker/remotion/templateConfig.ts`:

```ts
export type CaptionStyle = "viral" | "classico" | "karaoke";
export type TitleBoxPosition = "bottom-third" | "top-third";
export type LogoPosition = "top-right" | "top-left";

export interface VideoTemplateConfig {
  titleBox: {
    color: string;
    textColor: string;
    position: TitleBoxPosition;
    durationSeconds: number;
  };
  captionStyle: CaptionStyle;
  logo: { enabled: boolean; position: LogoPosition };
  progressBar: { enabled: boolean; color: string };
  footer: { enabled: boolean; text: string };
}
```

`render-worker/remotion/Root.tsx`:

```tsx
import React from "react";
import { Composition } from "remotion";
import { PuzzleTemplateV1 } from "./PuzzleTemplateV1";

export function RemotionRoot() {
  return (
    <Composition
      id="PuzzleTemplateV1"
      component={PuzzleTemplateV1}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoUrl: "",
        headline: "",
        words: [],
        config: {
          titleBox: { color: "#96DB12", textColor: "#000000", position: "bottom-third", durationSeconds: 3 },
          captionStyle: "viral",
          logo: { enabled: true, position: "top-right" },
          progressBar: { enabled: true, color: "#96DB12" },
          footer: { enabled: false, text: "SIGA @puzzlerecordss" },
        },
        logoUrl: "",
        durationInFrames: 900,
      }}
    />
  );
}
```

`render-worker/remotion/index.ts`:

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

- [ ] **Step 9: Confirmar que os testes de lógica pura continuam passando e o build de tipos do worker fecha**

Run: `cd render-worker && npm install && npm test && npx tsc --noEmit`
Expected: `npm test` PASS (3/3); `tsc --noEmit` sem erros.

**Nota para quem revisa:** não é possível, neste ambiente, rodar um render real do Remotion (`npx remotion render` baixa Chromium Headless Shell e precisa de rede irrestrita) — a composição React foi verificada só por tipos + a lógica de agrupamento de legendas por teste unitário. O primeiro render real de ponta a ponta é verificação manual do Victor na Task 5, depois do deploy no Railway.

- [ ] **Step 10: Commit**

```bash
git add render-worker/package.json render-worker/tsconfig.json render-worker/vitest.config.ts render-worker/remotion
git commit -m "feat(m14): composicao Remotion Puzzle v1 + agrupamento de legendas por timestamp"
```

---

## Task 5: `render-worker` — servidor Express + gerenciador de jobs assíncronos

**Files:**
- Create: `render-worker/src/jobs.ts`
- Create: `render-worker/src/jobs.test.ts`
- Create: `render-worker/src/render.ts`
- Create: `render-worker/src/index.ts`
- Create: `render-worker/Dockerfile`
- Create: `render-worker/.env.example`

**Interfaces:**
- Consumes: composição `PuzzleTemplateV1` da Task 4 (`render-worker/remotion/index.ts`), `WordTimestamp` da Task 4.
- Produces: `POST /render` (body `{ postId, videoUrl, headline, words: WordTimestamp[], config: VideoTemplateConfig, logoUrl }`, header `Authorization: Bearer <RENDER_WORKER_SECRET>`) → `202 { jobId }`; `GET /render/:jobId` → `200 { status: "processing" | "done" | "error", outputUrl?: string, error?: string }`. Consumidos pela Task 6 e Task 7 (`lib/renderWorker/client.ts`).

- [ ] **Step 1: Escrever o teste do gerenciador de jobs (falha primeiro)**

`render-worker/src/jobs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createJobStore } from "./jobs";

describe("createJobStore", () => {
  it("cria um job em processing e resolve pra done quando a execução termina", async () => {
    const store = createJobStore();
    const jobId = store.create();

    expect(store.get(jobId)).toEqual({ status: "processing" });

    await store.run(jobId, async () => "path/output.mp4");

    expect(store.get(jobId)).toEqual({ status: "done", outputUrl: "path/output.mp4" });
  });

  it("marca o job como error quando a execução lança", async () => {
    const store = createJobStore();
    const jobId = store.create();

    await store.run(jobId, async () => {
      throw new Error("falha no render");
    });

    expect(store.get(jobId)).toEqual({ status: "error", error: "falha no render" });
  });

  it("get retorna undefined para jobId desconhecido", () => {
    const store = createJobStore();
    expect(store.get("inexistente")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd render-worker && npm test`
Expected: FAIL — `./jobs` não existe.

- [ ] **Step 3: Implementar `jobs.ts`**

```ts
import { randomUUID } from "node:crypto";

export type JobRecord =
  | { status: "processing" }
  | { status: "done"; outputUrl: string }
  | { status: "error"; error: string };

export interface JobStore {
  create(): string;
  get(jobId: string): JobRecord | undefined;
  run(jobId: string, task: () => Promise<string>): Promise<void>;
}

/**
 * Store de jobs em memória do processo. Suficiente para o worker: cada
 * instância do Railway processa seus próprios renders, e o painel Next.js
 * nunca lê o estado diretamente — só via GET /render/:jobId (Task 6/7).
 * Se o processo reiniciar no meio de um render, o cron de submissão da
 * Task 6 não resubmete (video_render_job_id já gravado) e o polling da
 * Task 7 vai receber 404 e registrar erro explícito — não falha em
 * silêncio.
 */
export function createJobStore(): JobStore {
  const jobs = new Map<string, JobRecord>();

  return {
    create(): string {
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing" });
      return jobId;
    },
    get(jobId: string): JobRecord | undefined {
      return jobs.get(jobId);
    },
    async run(jobId: string, task: () => Promise<string>): Promise<void> {
      try {
        const outputUrl = await task();
        jobs.set(jobId, { status: "done", outputUrl });
      } catch (err) {
        jobs.set(jobId, {
          status: "error",
          error: err instanceof Error ? err.message : "erro desconhecido no render",
        });
      }
    },
  };
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npm test`
Expected: PASS (3/3, mais os 3 de `captions.test.ts` = 6/6 no total do pacote).

- [ ] **Step 5: Implementar `render.ts`**

```ts
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VideoTemplateConfig } from "../remotion/templateConfig";
import type { WordTimestamp } from "../remotion/captions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RenderJobInput {
  postId: string;
  videoUrl: string;
  headline: string;
  words: WordTimestamp[];
  config: VideoTemplateConfig;
  logoUrl: string;
}

let bundleLocationPromise: Promise<string> | null = null;

function getBundleLocation(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle({
      entryPoint: path.join(__dirname, "../remotion/index.ts"),
    });
  }
  return bundleLocationPromise;
}

/**
 * Renderiza o vídeo final com o template Puzzle v1 e devolve o caminho
 * absoluto do MP4 gerado no filesystem local do worker — quem chama
 * (index.ts) é responsável por subir esse arquivo pro Storage e limpá-lo.
 */
export async function renderVideoJob(input: RenderJobInput): Promise<string> {
  const serveUrl = await getBundleLocation();
  const durationInFrames = 900;

  const composition = await selectComposition({
    serveUrl,
    id: "PuzzleTemplateV1",
    inputProps: {
      videoUrl: input.videoUrl,
      headline: input.headline,
      words: input.words,
      config: input.config,
      logoUrl: input.logoUrl,
      durationInFrames,
    },
  });

  const outputLocation = path.join("/tmp", `puzzle-${input.postId}-${Date.now()}.mp4`);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps: {
      videoUrl: input.videoUrl,
      headline: input.headline,
      words: input.words,
      config: input.config,
      logoUrl: input.logoUrl,
      durationInFrames,
    },
  });

  return outputLocation;
}
```

- [ ] **Step 6: Implementar `index.ts` (servidor Express)**

```ts
import express from "express";
import { readFile, unlink } from "node:fs/promises";
import { createJobStore } from "./jobs";
import { renderVideoJob, type RenderJobInput } from "./render";

const app = express();
app.use(express.json({ limit: "10mb" }));

const jobStore = createJobStore();
const RENDER_WORKER_SECRET = process.env.RENDER_WORKER_SECRET;

function isAuthorized(req: express.Request): boolean {
  if (!RENDER_WORKER_SECRET) return false;
  return req.headers.authorization === `Bearer ${RENDER_WORKER_SECRET}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/render", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const input = req.body as RenderJobInput;
  const jobId = jobStore.create();

  void jobStore.run(jobId, async () => {
    const outputLocation = await renderVideoJob(input);
    const buffer = await readFile(outputLocation);
    await unlink(outputLocation);
    // O worker não fala com o Supabase diretamente: devolve o vídeo em
    // base64 no polling (Task 7 baixa e sobe pro Storage do lado do
    // Next.js) para manter as credenciais do Storage só num lugar.
    return buffer.toString("base64");
  });

  res.status(202).json({ jobId });
});

app.get("/render/:jobId", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const record = jobStore.get(req.params.jobId);
  if (!record) {
    res.status(404).json({ error: "job não encontrado" });
    return;
  }

  if (record.status === "done") {
    res.json({ status: "done", videoBase64: record.outputUrl });
    return;
  }

  res.json(record.status === "error" ? { status: "error", error: record.error } : { status: "processing" });
});

const port = process.env.PORT ?? 8080;
app.listen(port, () => {
  console.log(`render-worker ouvindo na porta ${port}`);
});
```

- [ ] **Step 7: `Dockerfile`**

```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV REMOTION_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "start"]
```

- [ ] **Step 8: `.env.example`**

```
RENDER_WORKER_SECRET=
PORT=8080
```

- [ ] **Step 9: Rodar os testes e o build de tipos do pacote inteiro**

Run: `cd render-worker && npm test && npx tsc --noEmit`
Expected: `npm test` PASS (6/6 — `captions.test.ts` + `jobs.test.ts`); `tsc --noEmit` sem erros.

**Nota para quem revisa:** `renderVideoJob`/`index.ts` não têm teste automatizado de execução real (dependem de Chromium via `@remotion/renderer`, indisponível no ambiente do subagent) — cobertos só por `tsc`. A verificação de ponta a ponta (deploy no Railway + `POST /render` real) é manual, do Victor, depois que a Task 7 estiver de pé e as credenciais do Railway configuradas — isso está fora do escopo deste plano (é uma ação de infraestrutura, não de código).

- [ ] **Step 10: Commit**

```bash
git add render-worker/src render-worker/Dockerfile render-worker/.env.example
git commit -m "feat(m14): servidor do render-worker com job assincrono POST/GET /render"
```

---

## Task 6: Cliente HTTP do worker + submissão de jobs (cron `generate-video-art`)

**Files:**
- Create: `lib/renderWorker/client.ts`
- Modify: `lib/posts/pendingArt.ts` (excluir vídeo — hoje `listPostsPendingArt` não filtra por `media_type`, então todo post de vídeo com `headline`+`template` cai no `renderArt` a cada 5 min e grava `art_generation_error` desnecessariamente; vídeo passa a ter seu próprio pipeline)
- Create: `lib/posts/pendingVideoArt.ts`
- Create: `app/api/cron/generate-video-art/route.ts`

**Interfaces:**
- Consumes: `getDefaultVideoTemplate()` (Task 2), `transcribeWithWordTimestamps` (Task 3), `VideoTemplate`/`VideoTemplateConfig` (Task 2), endpoint `POST /render` do worker (Task 5).
- Produces: `submitRenderJob(input): Promise<{ jobId: string }>` em `lib/renderWorker/client.ts`, consumida por esta task e reaproveitada pela Task 7 só para o `RENDER_WORKER_URL`/auth (a Task 7 usa `getRenderJobStatus`, adicionada nesta mesma task para manter o cliente HTTP num único arquivo).

- [ ] **Step 1: Cliente HTTP do worker**

`lib/renderWorker/client.ts`:

```ts
import type { VideoTemplateConfig } from "@/lib/types/template";
import type { WordTimestamp } from "@/lib/openai/videoAnalysis";

export class RenderWorkerError extends Error {}

interface SubmitRenderJobInput {
  postId: string;
  videoUrl: string;
  headline: string;
  words: WordTimestamp[];
  config: VideoTemplateConfig;
  logoUrl: string;
}

function getWorkerConfig(): { url: string; secret: string } {
  const url = process.env.RENDER_WORKER_URL;
  const secret = process.env.RENDER_WORKER_SECRET;
  if (!url || !secret) {
    throw new RenderWorkerError(
      "RENDER_WORKER_URL ou RENDER_WORKER_SECRET não configurados."
    );
  }
  return { url, secret };
}

export async function submitRenderJob(
  input: SubmitRenderJobInput
): Promise<{ jobId: string }> {
  const { url, secret } = getWorkerConfig();

  const response = await fetch(`${url}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(input),
  });

  if (response.status !== 202) {
    throw new RenderWorkerError(
      `Falha ao submeter job de render (status ${response.status}).`
    );
  }

  return (await response.json()) as { jobId: string };
}

export type RenderJobStatus =
  | { status: "processing" }
  | { status: "done"; videoBase64: string }
  | { status: "error"; error: string };

export async function getRenderJobStatus(jobId: string): Promise<RenderJobStatus> {
  const { url, secret } = getWorkerConfig();

  const response = await fetch(`${url}/render/${jobId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (response.status === 404) {
    throw new RenderWorkerError(`Job de render ${jobId} não encontrado no worker.`);
  }
  if (!response.ok) {
    throw new RenderWorkerError(`Falha ao consultar status do job ${jobId} (status ${response.status}).`);
  }

  return (await response.json()) as RenderJobStatus;
}
```

- [ ] **Step 2: Excluir vídeo de `listPostsPendingArt` e criar `pendingVideoArt.ts`**

Modifique `lib/posts/pendingArt.ts` — adicione o filtro de tipo à query existente (mantendo o resto do arquivo igual):

```ts
  const { data, error } = await supabase
    .from("posts")
    .select("id, template, headline, media_url, media_type")
    .eq("media_type", "image")
    .not("headline", "is", null)
    .not("template", "is", null)
    .is("rendered_art_url", null)
    .is("art_generation_error", null);
```

`lib/posts/pendingVideoArt.ts` (novo arquivo):

```ts
import { createServiceClient } from "@/lib/supabase/service";

export interface PostPendingVideoArt {
  id: string;
  headline: string;
  media_url: string;
}

export async function listPostsPendingVideoArt(): Promise<PostPendingVideoArt[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id, headline, media_url")
    .eq("media_type", "video")
    .not("headline", "is", null)
    .is("video_render_job_id", null)
    .is("rendered_art_url", null)
    .is("art_generation_error", null);

  if (error) {
    console.error("[pendingVideoArt] falha ao buscar posts pendentes de render de vídeo:", error.message);
    return [];
  }

  return (data ?? []) as PostPendingVideoArt[];
}
```

- [ ] **Step 3: Cron `generate-video-art`**

`app/api/cron/generate-video-art/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listPostsPendingVideoArt } from "@/lib/posts/pendingVideoArt";
import { getDefaultVideoTemplate } from "@/lib/templates/queries";
import { transcribeWithWordTimestamps, VideoAnalysisError } from "@/lib/openai/videoAnalysis";
import { submitRenderJob, RenderWorkerError } from "@/lib/renderWorker/client";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function recordError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ art_generation_error: message })
    .eq("id", postId);
  if (error) {
    console.error(`[generate-video-art] falha ao gravar art_generation_error do post ${postId}:`, error.message);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [pending, template] = await Promise.all([
    listPostsPendingVideoArt(),
    getDefaultVideoTemplate(),
  ]);

  if (!template) {
    return NextResponse.json({ error: "nenhum template de vídeo default configurado" }, { status: 500 });
  }

  const supabase = createServiceClient();
  let submitted = 0;

  for (const post of pending) {
    try {
      const { data: signedUrlData, error: signError } = await supabase.storage
        .from("posts-media")
        .createSignedUrl(post.media_url, 60 * 30);
      if (signError || !signedUrlData) {
        throw new RenderWorkerError(`Não foi possível gerar URL assinada do vídeo: ${signError?.message ?? "desconhecido"}`);
      }

      const videoResponse = await fetch(signedUrlData.signedUrl);
      if (!videoResponse.ok) {
        throw new RenderWorkerError(`Falha ao baixar o vídeo original (status ${videoResponse.status}).`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      const words = await transcribeWithWordTimestamps(videoBuffer, post.media_url);

      const { jobId } = await submitRenderJob({
        postId: post.id,
        videoUrl: signedUrlData.signedUrl,
        headline: post.headline,
        words,
        config: template.config,
        logoUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/puzzle-records-logo.svg`,
      });

      const { error } = await supabase
        .from("posts")
        .update({ video_template_id: template.id, video_render_job_id: jobId, video_render_status: "processing" })
        .eq("id", post.id);

      if (error) {
        console.error(`[generate-video-art] falha ao gravar video_render_job_id do post ${post.id}:`, error.message);
        continue;
      }
      submitted += 1;
    } catch (err) {
      const message =
        err instanceof VideoAnalysisError || err instanceof RenderWorkerError
          ? err.message
          : "Erro inesperado ao submeter o render de vídeo.";
      await recordError(post.id, message);
    }
  }

  return NextResponse.json({ submitted, total: pending.length });
}
```

- [ ] **Step 4: Verificar tipos e lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add lib/renderWorker/client.ts lib/posts/pendingArt.ts lib/posts/pendingVideoArt.ts app/api/cron/generate-video-art/route.ts
git commit -m "feat(m14): cliente do render-worker e cron generate-video-art"
```

---

## Task 7: Cron `poll-video-render` (resolve o job e sobe o MP4 pro Storage)

**Files:**
- Create: `app/api/cron/poll-video-render/route.ts`
- Modify: `vercel.json` (registrar os dois crons novos, `generate-video-art` e `poll-video-render`, mesma cadência de 5 min dos crons existentes)

**Interfaces:**
- Consumes: `getRenderJobStatus` (Task 6), tabela `posts` (colunas `video_render_job_id`, `video_render_status`, `rendered_art_url`, `art_generation_error` da Task 1).

- [ ] **Step 1: Ler `vercel.json` atual para replicar o formato exato dos crons existentes antes de editar**

Run: `cat vercel.json`

- [ ] **Step 2: Cron `poll-video-render`**

`app/api/cron/poll-video-render/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getRenderJobStatus, RenderWorkerError } from "@/lib/renderWorker/client";

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
  const { data: pending, error } = await supabase
    .from("posts")
    .select("id, video_render_job_id")
    .eq("video_render_status", "processing")
    .not("video_render_job_id", "is", null);

  if (error) {
    console.error("[poll-video-render] falha ao buscar posts com render em andamento:", error.message);
    return NextResponse.json({ error: "falha ao consultar posts" }, { status: 500 });
  }

  let resolved = 0;

  for (const post of pending ?? []) {
    try {
      const status = await getRenderJobStatus(post.video_render_job_id as string);

      if (status.status === "processing") {
        continue;
      }

      if (status.status === "error") {
        await supabase
          .from("posts")
          .update({ video_render_status: "error", art_generation_error: status.error })
          .eq("id", post.id);
        continue;
      }

      const videoBuffer = Buffer.from(status.videoBase64, "base64");
      const artPath = `video-art-${post.id}-${Date.now()}.mp4`;
      const { error: uploadError } = await supabase.storage
        .from("posts-media")
        .upload(artPath, videoBuffer, { contentType: "video/mp4", upsert: false });

      if (uploadError) {
        await supabase
          .from("posts")
          .update({ video_render_status: "error", art_generation_error: `Falha ao subir o vídeo renderizado: ${uploadError.message}` })
          .eq("id", post.id);
        continue;
      }

      await supabase
        .from("posts")
        .update({ video_render_status: "done", rendered_art_url: artPath })
        .eq("id", post.id);
      resolved += 1;
    } catch (err) {
      const message = err instanceof RenderWorkerError ? err.message : "Erro inesperado ao resolver o render de vídeo.";
      await supabase
        .from("posts")
        .update({ video_render_status: "error", art_generation_error: message })
        .eq("id", post.id);
    }
  }

  return NextResponse.json({ resolved, total: (pending ?? []).length });
}
```

- [ ] **Step 3: Registrar os crons em `vercel.json`**

Adicione entradas para `/api/cron/generate-video-art` e `/api/cron/poll-video-render` seguindo exatamente o mesmo formato (`path`, `schedule`) das entradas existentes para `/api/cron/generate-art` já presentes no arquivo (schedule idêntico ao de `generate-art`, a cada 5 minutos).

- [ ] **Step 4: Verificar tipos e lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/poll-video-render/route.ts vercel.json
git commit -m "feat(m14): cron poll-video-render resolve o job e sobe o mp4 renderizado"
```

---

## Task 8: Página `/templates`

**Files:**
- Create: `app/(dashboard)/templates/page.tsx`
- Create: `lib/templates/actions.ts`
- Create: `components/templates/template-card.tsx`
- Create: `components/templates/template-form-dialog.tsx`

**Interfaces:**
- Consumes: `listVideoTemplates()` (Task 2), `VideoTemplate`/`VideoTemplateConfig` (Task 2).
- Produces: Server Actions `createTemplate(formData: FormData)`, `updateTemplate(id: string, formData: FormData)`, `duplicateTemplate(id: string)` em `lib/templates/actions.ts`.

- [ ] **Step 1: Ler `app/(dashboard)/acervo/page.tsx` e o `layout.tsx` do grupo para replicar exatamente o padrão de Server Component + checagem de `profile`/role já usado nas outras páginas do painel, antes de escrever a nova página**

Run: `cat "app/(dashboard)/layout.tsx"` e `cat "app/(dashboard)/acervo/page.tsx"`

- [ ] **Step 2: Server Actions**

`lib/templates/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { VideoTemplateConfig } from "@/lib/types/template";

function parseConfigFromForm(formData: FormData): VideoTemplateConfig {
  return {
    titleBox: {
      color: String(formData.get("titleBoxColor") ?? "#96DB12"),
      textColor: String(formData.get("titleBoxTextColor") ?? "#000000"),
      position: formData.get("titleBoxPosition") === "top-third" ? "top-third" : "bottom-third",
      durationSeconds: Number(formData.get("titleBoxDuration") ?? 3),
    },
    captionStyle:
      formData.get("captionStyle") === "classico" || formData.get("captionStyle") === "karaoke"
        ? (formData.get("captionStyle") as "classico" | "karaoke")
        : "viral",
    logo: {
      enabled: formData.get("logoEnabled") === "on",
      position: formData.get("logoPosition") === "top-left" ? "top-left" : "top-right",
    },
    progressBar: {
      enabled: formData.get("progressBarEnabled") === "on",
      color: String(formData.get("progressBarColor") ?? "#96DB12"),
    },
    footer: {
      enabled: formData.get("footerEnabled") === "on",
      text: String(formData.get("footerText") ?? "SIGA @puzzlerecordss"),
    },
  };
}

export async function createTemplate(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Nome do template é obrigatório." };
  }

  const { error } = await supabase.from("templates").insert({
    name,
    config: parseConfigFromForm(formData),
    format: "9:16",
    is_default: false,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/templates");
  return { error: null };
}

export async function updateTemplate(id: string, formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Nome do template é obrigatório." };
  }

  const { error } = await supabase
    .from("templates")
    .update({ name, config: parseConfigFromForm(formData) })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/templates");
  return { error: null };
}

export async function duplicateTemplate(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: original, error: fetchError } = await supabase
    .from("templates")
    .select("name, config, format")
    .eq("id", id)
    .single();

  if (fetchError || !original) {
    return { error: fetchError?.message ?? "Template original não encontrado." };
  }

  const { error } = await supabase.from("templates").insert({
    name: `${original.name} (cópia)`,
    config: original.config,
    format: original.format,
    is_default: false,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/templates");
  return { error: null };
}
```

- [ ] **Step 3: Página**

`app/(dashboard)/templates/page.tsx` (siga exatamente o padrão de checagem de `profile`/role lido no Step 1 — importe `getCurrentProfile` do mesmo caminho usado em `app/(dashboard)/layout.tsx` e redirecione para `/login` se ausente, igual às demais páginas do grupo):

```tsx
import { listVideoTemplates } from "@/lib/templates/queries";
import { TemplateCard } from "@/components/templates/template-card";
import { TemplateFormDialog } from "@/components/templates/template-form-dialog";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await listVideoTemplates();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Templates de vídeo</h1>
          <p className="text-sm text-muted-foreground">
            Galeria de templates aplicados automaticamente no render de vídeo. Customize cores, fonte da legenda e elementos on/off — sem editor de timeline.
          </p>
        </div>
        <TemplateFormDialog mode="create" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `template-card.tsx`**

`components/templates/template-card.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { duplicateTemplate } from "@/lib/templates/actions";
import { TemplateFormDialog } from "./template-form-dialog";
import type { VideoTemplate } from "@/lib/types/template";

export function TemplateCard({ template }: { template: VideoTemplate }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{template.name}</h3>
        {template.is_default && (
          <span className="rounded bg-[#96DB12] px-2 py-0.5 text-xs font-semibold text-black">Default</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <dt>Legenda</dt>
        <dd>{template.config.captionStyle}</dd>
        <dt>Título</dt>
        <dd>{template.config.titleBox.position}</dd>
        <dt>Logo</dt>
        <dd>{template.config.logo.enabled ? "ligada" : "desligada"}</dd>
        <dt>Progresso</dt>
        <dd>{template.config.progressBar.enabled ? "ligada" : "desligada"}</dd>
      </dl>
      <div className="flex gap-2">
        <TemplateFormDialog mode="edit" template={template} />
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => void duplicateTemplate(template.id))}
          className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Duplicar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `template-form-dialog.tsx`**

`components/templates/template-form-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { createTemplate, updateTemplate } from "@/lib/templates/actions";
import type { VideoTemplate } from "@/lib/types/template";

interface TemplateFormDialogProps {
  mode: "create" | "edit";
  template?: VideoTemplate;
}

export function TemplateFormDialog({ mode, template }: TemplateFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const config = template?.config;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createTemplate(formData)
          : await updateTemplate(template!.id, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        {mode === "create" ? "Novo template" : "Editar"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <form
            action={handleSubmit}
            className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-6"
          >
            <h2 className="font-medium">{mode === "create" ? "Novo template" : `Editar ${template?.name}`}</h2>

            <label className="text-sm">
              Nome
              <input name="name" defaultValue={template?.name} required className="mt-1 w-full rounded border border-border bg-background p-2" />
            </label>

            <label className="text-sm">
              Cor da caixa de título
              <input name="titleBoxColor" type="color" defaultValue={config?.titleBox.color ?? "#96DB12"} className="mt-1 w-full" />
            </label>

            <label className="text-sm">
              Cor do texto do título
              <input name="titleBoxTextColor" type="color" defaultValue={config?.titleBox.textColor ?? "#000000"} className="mt-1 w-full" />
            </label>

            <label className="text-sm">
              Posição do título
              <select name="titleBoxPosition" defaultValue={config?.titleBox.position ?? "bottom-third"} className="mt-1 w-full rounded border border-border bg-background p-2">
                <option value="bottom-third">Terço inferior</option>
                <option value="top-third">Terço superior</option>
              </select>
            </label>

            <label className="text-sm">
              Duração do título (segundos)
              <input name="titleBoxDuration" type="number" min={1} max={10} defaultValue={config?.titleBox.durationSeconds ?? 3} className="mt-1 w-full rounded border border-border bg-background p-2" />
            </label>

            <label className="text-sm">
              Estilo de legenda
              <select name="captionStyle" defaultValue={config?.captionStyle ?? "viral"} className="mt-1 w-full rounded border border-border bg-background p-2">
                <option value="viral">Viral (palavra destacada)</option>
                <option value="classico">Clássico</option>
                <option value="karaoke">Karaokê</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input name="logoEnabled" type="checkbox" defaultChecked={config?.logo.enabled ?? true} />
              Logo ligada
            </label>

            <label className="text-sm">
              Posição da logo
              <select name="logoPosition" defaultValue={config?.logo.position ?? "top-right"} className="mt-1 w-full rounded border border-border bg-background p-2">
                <option value="top-right">Canto superior direito</option>
                <option value="top-left">Canto superior esquerdo</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input name="progressBarEnabled" type="checkbox" defaultChecked={config?.progressBar.enabled ?? true} />
              Barra de progresso ligada
            </label>

            <label className="text-sm">
              Cor da barra de progresso
              <input name="progressBarColor" type="color" defaultValue={config?.progressBar.color ?? "#96DB12"} className="mt-1 w-full" />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input name="footerEnabled" type="checkbox" defaultChecked={config?.footer.enabled ?? false} />
              Rodapé ligado
            </label>

            <label className="text-sm">
              Texto do rodapé
              <input name="footerText" defaultValue={config?.footer.text ?? "SIGA @puzzlerecordss"} className="mt-1 w-full rounded border border-border bg-background p-2" />
            </label>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded px-3 py-1.5 text-xs">
                Cancelar
              </button>
              <button type="submit" disabled={isPending} className="rounded bg-[#96DB12] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
                {isPending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros novos; build fecha (confirma que a nova rota `/templates` compila dentro do App Router).

- [ ] **Step 7: Verificação manual (sem harness de UI automatizado neste repo)**

Rode `npm run dev`, acesse `/templates` autenticado como admin, confirme: o template seed "Puzzle v1" aparece marcado como "Default"; "Novo template" cria uma linha nova em `templates`; "Editar" atualiza o `config` existente; "Duplicar" cria uma cópia com `is_default = false`.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/templates" lib/templates/actions.ts components/templates
git commit -m "feat(m14): pagina /templates com galeria e formulario de customizacao"
```

---

## Definition of Done (checklist do M14 no PLAN.md)

- [ ] Um vídeo de exemplo passa pelo motor de templates com legenda sincronizada e sai com a identidade visual da Puzzle Records — verificado manualmente pelo Victor após o deploy do `render-worker` no Railway (fora do escopo automatizável deste plano, ver notas das Tasks 4 e 5).
- [ ] A página `/templates` permite escolher e customizar um template sem editar código — coberto pela Task 8.
