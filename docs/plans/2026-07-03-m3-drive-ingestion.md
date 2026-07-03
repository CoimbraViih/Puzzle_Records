# M3 — Ingestão do Google Drive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, dispatching a fresh subagent per task with a code-reviewer pass between tasks.

**Goal:** Conteúdo entra no sistema sem intervenção manual — soltar um par mídia+`.json` na pasta do Google Drive cria um post com status `pendente` no painel em poucos minutos, sem manchete/legenda ainda (isso fica para o M4).

**Architecture:** Um cron da Vercel (`/api/cron/drive-ingest`, a cada 5 minutos) autentica no Drive via Service Account, lista os arquivos da pasta raiz configurada, agrupa por nome-base em pares mídia+metadado, e para cada par completo baixa o metadado, resolve artista/conta social por nome/handle (sem match = post criado mesmo assim com aviso), sobe a mídia pro Storage, insere o post com `status = 'pendente'` e move os arquivos originais para a subpasta `Processados/`. Uma tabela `drive_ingestions` registra sucesso (dedupe permanente) e erros de metadado (log, sem bloquear retry). O schema de `posts` é relaxado (`social_account_id`, `template`, `headline`, `caption`, `created_by` passam a aceitar `null`) e ganha `source_fact`/`track_name` para guardar a matéria-prima que o M4 vai usar. Toda a lógica de Drive fica isolada em `lib/drive/`, seguindo o mesmo princípio de camada isolada já usado para o Zernio.

**Tech Stack:** Next.js 16 (App Router, Route Handler), Vercel Cron, `googleapis` (cliente oficial do Google Drive API), Supabase (Postgres + Storage, cliente service-role), TypeScript.

Spec de referência: `docs/superpowers/specs/2026-07-03-m3-drive-ingestion-design.md`

**Sem framework de testes automatizados no projeto** (nenhum `vitest`/`jest` instalado — M1/M2 seguiram o mesmo padrão). Cada task usa `npx tsc --noEmit` + `npm run lint` como verificação, e a lógica pura (`pairFiles`, `parseMetadata`, `matchArtistAndAccount`) fica em funções pequenas e isoladas para ser fácil de revisar e testar manualmente. A Task final é um checklist de teste manual ponta a ponta contra um Drive/Supabase reais, no mesmo formato usado pelo M1/M2.

---

### Task 1: Migração SQL — relaxar `posts`, adicionar `drive_ingestions`

**Agent:** fullstack-developer
**Skills de apoio:** `supabase`, `supabase-postgres-best-practices`

**Files:**
- Create: `supabase/migrations/0003_drive_ingestion.sql`

**Passos:**

1. Ler a spec (`docs/superpowers/specs/2026-07-03-m3-drive-ingestion-design.md`) antes de escrever — o modelo de dados já está decidido lá.

2. Criar `supabase/migrations/0003_drive_ingestion.sql` com o conteúdo exato:

```sql
-- M3: ingestão do Google Drive cria posts "esqueleto" (sem manchete/legenda
-- ainda, ver M4) — relaxa colunas que só existiam no fluxo manual do M2,
-- adiciona os campos de matéria-prima pro M4 e a tabela de auditoria/dedupe
-- da ingestão.

alter table public.posts
  alter column social_account_id drop not null,
  alter column template drop not null,
  alter column headline drop not null,
  alter column caption drop not null,
  alter column created_by drop not null;

alter table public.posts
  drop constraint posts_status_check;

alter table public.posts
  add constraint posts_status_check
  check (status in ('pendente', 'rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado'));

-- Aviso visível na fila quando o artista/conta social do JSON de metadado
-- não bate com nenhum registro cadastrado (nunca falha em silêncio).
alter table public.posts
  add column ingestion_warning text;

-- Matéria-prima vinda do JSON de metadado do Drive: o M4 usa source_fact
-- pra gerar a manchete/legenda, e track_name pra taggear a música em posts
-- de lançamento (regra do guia de estilo).
alter table public.posts
  add column source_fact text,
  add column track_name text;

-- Trilha de auditoria/dedupe: evita reprocessar um arquivo do Drive mesmo
-- que o move pra subpasta "Processados" falhe depois de já ter criado o
-- post. Só linhas com status='processado' bloqueiam reprocessamento —
-- linhas 'erro' (ex: JSON malformado) não impedem nova tentativa depois
-- que a equipe corrigir o arquivo na pasta.
create table public.drive_ingestions (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  post_id uuid references public.posts (id),
  status text not null check (status in ('processado', 'erro')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.drive_ingestions enable row level security;

-- Log técnico: só admin lê. Escrita só acontece via service role (rota de
-- cron), que ignora RLS — não precisa de policy de insert/update.
create policy "drive_ingestions_select_admin"
  on public.drive_ingestions for select
  using (public.is_admin());
```

Nota: `drive_file_id` não é `unique` de propósito — o mesmo arquivo pode gerar múltiplas linhas `erro` até a equipe corrigir o metadado (ver comentário no SQL). O dedupe real é feito em código, filtrando por `status = 'processado'` (Task 8).

3. Verificar que a migration está sintaticamente correta rodando (sem aplicar em produção ainda):

Run: `npx supabase db lint supabase/migrations/0003_drive_ingestion.sql` (se o comando não existir na versão da CLI instalada, pular esta checagem e confiar na revisão manual do SQL — não é bloqueante).

**Passo de commit:**

```bash
git add supabase/migrations/0003_drive_ingestion.sql
git commit -m "feat(db): schema do M3 — status pendente, campos nullable e drive_ingestions"
```

---

### Task 2: Extrair cliente Supabase service-role compartilhado

**Agent:** typescript-pro

**Files:**
- Create: `lib/supabase/service.ts`
- Modify: `app/api/admin/usuarios/route.ts:1-21`

**Contexto:** `app/api/admin/usuarios/route.ts` já tem uma função local `getServiceClient()` que cria um client Supabase com a service-role key (necessário pra rotas sem sessão de usuário, como convites e — agora — o cron de ingestão). Extrair pra `lib/supabase/service.ts` evita duplicar essa lógica no cron do Drive.

**Passo 1: Criar o helper compartilhado**

```ts
// lib/supabase/service.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com a service-role key — ignora RLS. Só para uso em
 * rotas de servidor sem sessão de usuário (convites de admin, cron de
 * ingestão do Drive). Nunca expor ao client.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

**Passo 2: Atualizar `app/api/admin/usuarios/route.ts` pra usar o helper**

Substituir as linhas 1, 8-21 (a função local `getServiceClient`) por um import do helper novo:

```ts
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { ROLES, type Role } from "@/lib/types/profile";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}
```

E trocar toda ocorrência de `getServiceClient()` no restante do arquivo por `createServiceClient()` (a chamada em `POST`, dentro do `try`).

**Passo 3: Verificar tipos e lint**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm run lint`
Expected: sem erros novos.

**Passo de commit:**

```bash
git add lib/supabase/service.ts app/api/admin/usuarios/route.ts
git commit -m "refactor(supabase): extrair cliente service-role compartilhado"
```

---

### Task 3: Atualizar tipos de `Post` (status `pendente`, campos nullable, `ingestion_warning`)

**Agent:** typescript-pro

**Files:**
- Modify: `lib/types/post.ts`

**Passo 1: Editar `lib/types/post.ts`**

Substituir o arquivo inteiro por:

```ts
export const POST_STATUSES = [
  "pendente",
  "rascunho",
  "pendente_aprovacao",
  "aprovado",
  "rejeitado",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  pendente: "Pendente (Drive)",
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente de aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

export const POST_TEMPLATES = ["A", "B"] as const;
export type PostTemplate = (typeof POST_TEMPLATES)[number];

export const POST_TYPES = [
  "viral_geral",
  "noticia_funk",
  "lancamento",
] as const;

export type PostType = (typeof POST_TYPES)[number];

export const POST_TYPE_LABELS: Record<PostType, string> = {
  viral_geral: "Viral geral",
  noticia_funk: "Notícia funk",
  lancamento: "Lançamento",
};

export const MEDIA_TYPES = ["image", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface Post {
  id: string;
  artist_id: string | null;
  social_account_id: string | null;
  template: PostTemplate | null;
  post_type: PostType;
  headline: string | null;
  caption: string | null;
  media_url: string;
  media_type: MediaType;
  status: PostStatus;
  scheduled_at: string | null;
  rejection_reason: string | null;
  /** Preenchido pelo M3 quando artista/conta social do Drive não têm match. */
  ingestion_warning: string | null;
  /** Preenchidos pelo M3 a partir do JSON de metadado; consumidos pelo M4. */
  source_fact: string | null;
  track_name: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostWithRelations extends Post {
  artist: { id: string; name: string; handle: string } | null;
  social_account: {
    id: string;
    network: string;
    handle: string;
    display_name: string;
  } | null;
  /** Preenchido só pela camada de leitura (lib/posts/queries.ts). */
  media_signed_url?: string | null;
}
```

**Passo 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: erros apontando os pontos que assumiam campos não-nulos (`components/kanban/post-card.tsx`, `components/kanban/post-form-dialog.tsx` se houver). Isso é esperado — serão corrigidos na Task 6. Anotar os erros aqui, mas não corrigir ainda.

**Passo de commit:**

```bash
git add lib/types/post.ts
git commit -m "feat(types): status 'pendente', campos nullable e source_fact/track_name em Post"
```

---

### Task 4: Variáveis de ambiente — Service Account e `CRON_SECRET`

**Agent:** fullstack-developer

**Files:**
- Modify: `.env.example`

**Contexto:** O `.env.example` atual (desde o M0) já previa OAuth pessoal (`GOOGLE_DRIVE_CLIENT_ID`/`_CLIENT_SECRET`/`_REFRESH_TOKEN`) pro Drive — decisão trocada durante o design do M3 pra Service Account (não depende de login pessoal do Victor, ver spec). Substituir esses três por uma única chave de service account, e adicionar `CRON_SECRET` pra proteger a rota de cron.

**Passo 1: Editar `.env.example`**

Substituir o bloco (linhas 21-28 do arquivo atual):

```
# Google Drive API — Google Cloud Console > APIs & Services > Credentials
# (OAuth 2.0 Client ID configurado para acesso à Drive API)
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
# Gerado via fluxo OAuth (playground ou script local) com o client acima
GOOGLE_DRIVE_REFRESH_TOKEN=
# ID da pasta do Google Drive usada pelo agente (parte final da URL da pasta)
GOOGLE_DRIVE_FOLDER_ID=
```

Por:

```
# Google Drive API — Service Account (Google Cloud Console > IAM & Admin >
# Service Accounts > criar chave JSON). Compartilhe a pasta de ingestão com
# o e-mail "client_email" da service account, papel "Editor".
# Cole o conteúdo do JSON inteiro, numa linha só (sem quebras de linha).
GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY=
# ID da pasta do Google Drive usada pelo agente (parte final da URL da pasta)
GOOGLE_DRIVE_FOLDER_ID=

# Cron — protege as rotas /api/cron/** contra chamadas externas não
# autorizadas. A Vercel injeta automaticamente o header
# "Authorization: Bearer <CRON_SECRET>" nas chamadas que ela mesma agenda,
# desde que essa env var esteja configurada no projeto.
CRON_SECRET=
```

**Passo de commit:**

```bash
git add .env.example
git commit -m "docs(env): trocar OAuth por Service Account no Drive e adicionar CRON_SECRET"
```

---

### Task 5: `lib/drive/client.ts` e `lib/drive/pairFiles.ts` (autenticação + agrupamento puro)

**Agent:** typescript-pro

**Files:**
- Create: `lib/drive/client.ts`
- Create: `lib/drive/pairFiles.ts`

**Passo 1: Instalar a dependência**

Run: `npm install googleapis`
Expected: `googleapis` aparece em `dependencies` no `package.json`.

**Passo 2: Criar `lib/drive/client.ts`**

```ts
import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * Autentica no Google Drive via Service Account. A pasta de ingestão
 * precisa estar compartilhada (papel "Editor") com o e-mail "client_email"
 * dessa chave — ver docs/DEPLOY.md.
 */
export function createDriveClient(): drive_v3.Drive {
  const rawKey = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error(
      "Missing GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable."
    );
  }

  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(rawKey);
  } catch {
    throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY não é um JSON válido.");
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
  });

  return google.drive({ version: "v3", auth });
}
```

**Passo 3: Criar `lib/drive/pairFiles.ts`**

```ts
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
```

**Passo 4: Verificar `pairFiles` manualmente**

Como o projeto não tem framework de teste, verificar a lógica com um script descartável rodado via `node` (não commitar):

```bash
node -e "
const { pairFiles } = require('./lib/drive/pairFiles.ts');
" 2>&1 | head -5
```

Isso vai falhar porque `node` não entende TypeScript direto — em vez disso, validar por leitura de código (a função é pequena e pura) e confirmar no `tsc --noEmit` que compila sem erros. A validação funcional real acontece no teste manual ponta a ponta (Task 13).

Run: `npx tsc --noEmit`
Expected: sem erros nos dois arquivos novos.

**Passo de commit:**

```bash
git add lib/drive/client.ts lib/drive/pairFiles.ts package.json package-lock.json
git commit -m "feat(drive): cliente Service Account e agrupamento de arquivos em pares"
```

---

### Task 6: `lib/drive/listPendingFiles.ts` e `lib/drive/folders.ts`

**Agent:** typescript-pro

**Files:**
- Create: `lib/drive/listPendingFiles.ts`
- Create: `lib/drive/folders.ts`

**Passo 1: Criar `lib/drive/listPendingFiles.ts`**

```ts
import type { drive_v3 } from "googleapis";

import type { DriveFile } from "./pairFiles";

/**
 * Lista os arquivos que estão diretamente na pasta raiz (não em
 * subpastas). Arquivos já movidos para "Processados" somem dessa lista
 * naturalmente, porque o parent deles muda quando são movidos — não
 * precisa filtrar isso explicitamente.
 */
export async function listRootFiles(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<DriveFile[]> {
  const response = await drive.files.list({
    q: `'${rootFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, mimeType)",
    pageSize: 100,
  });

  return (response.data.files ?? [])
    .filter((file) => file.id && file.name && file.mimeType)
    .map((file) => ({
      id: file.id as string,
      name: file.name as string,
      mimeType: file.mimeType as string,
    }));
}
```

**Passo 2: Criar `lib/drive/folders.ts`**

```ts
import type { drive_v3 } from "googleapis";

const PROCESSED_FOLDER_NAME = "Processados";

/**
 * Acha (ou cria, na primeira execução) a subpasta "Processados" dentro da
 * pasta raiz de ingestão. Arquivos movidos pra lá saem da listagem de
 * `listRootFiles` e ficam disponíveis como histórico/auditoria visual.
 */
export async function findOrCreateProcessedFolder(
  drive: drive_v3.Drive,
  rootFolderId: string
): Promise<string> {
  const existing = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${PROCESSED_FOLDER_NAME}' and trashed = false`,
    fields: "files(id, name)",
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name: PROCESSED_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error("Falha ao criar a subpasta 'Processados' no Drive.");
  }

  return created.data.id;
}
```

**Passo 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros nos dois arquivos novos.

**Passo de commit:**

```bash
git add lib/drive/listPendingFiles.ts lib/drive/folders.ts
git commit -m "feat(drive): listagem da pasta raiz e resolução da subpasta Processados"
```

---

### Task 7: `lib/drive/metadata.ts` e `lib/drive/matchArtistAndAccount.ts`

**Agent:** typescript-pro

**Files:**
- Create: `lib/drive/metadata.ts`
- Create: `lib/drive/matchArtistAndAccount.ts`

**Passo 1: Criar `lib/drive/metadata.ts`**

```ts
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
```

**Passo 2: Criar `lib/drive/matchArtistAndAccount.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MatchResult {
  artistId: string | null;
  socialAccountId: string | null;
  warning: string | null;
}

async function findArtistId(
  supabase: SupabaseClient,
  artistText: string
): Promise<string | null> {
  const { data: byName } = await supabase
    .from("artists")
    .select("id")
    .ilike("name", artistText)
    .limit(1)
    .maybeSingle();
  if (byName?.id) return byName.id;

  const { data: byHandle } = await supabase
    .from("artists")
    .select("id")
    .ilike("handle", artistText)
    .limit(1)
    .maybeSingle();
  return byHandle?.id ?? null;
}

async function findSocialAccountId(
  supabase: SupabaseClient,
  handleText: string
): Promise<string | null> {
  const { data } = await supabase
    .from("social_accounts")
    .select("id")
    .ilike("handle", handleText)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Resolve artista e conta social por nome/handle (texto vindo do JSON de
 * metadado). Sem match não é erro — o post é criado mesmo assim, sem
 * vínculo, com uma mensagem de aviso pra equipe corrigir na fila (nunca
 * falha em silêncio, ver docs/CLAUDE.md).
 */
export async function matchArtistAndAccount(
  supabase: SupabaseClient,
  artistText: string | null,
  socialAccountText: string
): Promise<MatchResult> {
  const warnings: string[] = [];

  let artistId: string | null = null;
  if (artistText) {
    artistId = await findArtistId(supabase, artistText);
    if (!artistId) warnings.push(`artista não encontrado: "${artistText}"`);
  }

  const socialAccountId = await findSocialAccountId(supabase, socialAccountText);
  if (!socialAccountId) {
    warnings.push(`conta social não encontrada: "${socialAccountText}"`);
  }

  return {
    artistId,
    socialAccountId,
    warning: warnings.length > 0 ? warnings.join("; ") : null,
  };
}
```

**Passo 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros nos dois arquivos novos.

**Passo de commit:**

```bash
git add lib/drive/metadata.ts lib/drive/matchArtistAndAccount.ts
git commit -m "feat(drive): parser de metadado e match de artista/conta social"
```

---

### Task 8: `lib/drive/ingestFile.ts` (orquestração)

**Agent:** typescript-pro

**Files:**
- Create: `lib/drive/ingestFile.ts`

**Passo 1: Criar `lib/drive/ingestFile.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { drive_v3 } from "googleapis";

import { InvalidMetadataError, parseMetadata } from "./metadata";
import { matchArtistAndAccount } from "./matchArtistAndAccount";
import type { FilePair } from "./pairFiles";

function mediaTypeFromMimeType(mimeType: string): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

async function downloadFileContent(
  drive: drive_v3.Drive,
  fileId: string
): Promise<Buffer> {
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data as ArrayBuffer);
}

async function moveToProcessed(
  drive: drive_v3.Drive,
  fileId: string,
  processedFolderId: string,
  rootFolderId: string
): Promise<void> {
  await drive.files.update({
    fileId,
    addParents: processedFolderId,
    removeParents: rootFolderId,
  });
}

async function recordError(
  supabase: SupabaseClient,
  driveFileId: string,
  message: string
): Promise<void> {
  console.error("Erro na ingestão do Drive:", driveFileId, message);
  await supabase
    .from("drive_ingestions")
    .insert({ drive_file_id: driveFileId, status: "erro", error_message: message });
}

/**
 * Processa um par mídia+metadado: baixa e valida o JSON, sobe a mídia pro
 * Storage, resolve artista/conta social, insere o post 'pendente' e move
 * os arquivos originais pra "Processados". Falhas transitórias (download,
 * upload) não são registradas em drive_ingestions — o par continua
 * elegível na próxima execução do cron. Falhas de metadado são registradas
 * como 'erro' (log, não bloqueia retry depois que a equipe corrigir).
 */
export async function ingestFilePair(
  drive: drive_v3.Drive,
  supabase: SupabaseClient,
  pair: FilePair,
  processedFolderId: string,
  rootFolderId: string
): Promise<void> {
  const alreadyProcessed = await supabase
    .from("drive_ingestions")
    .select("id")
    .eq("drive_file_id", pair.media.id)
    .eq("status", "processado")
    .maybeSingle();

  if (alreadyProcessed.data) return;

  let metadataText: string;
  try {
    const buffer = await downloadFileContent(drive, pair.metadata.id);
    metadataText = buffer.toString("utf-8");
  } catch (err) {
    console.error("Falha ao baixar o metadado do Drive (tenta de novo depois):", err);
    return;
  }

  let metadata;
  try {
    metadata = parseMetadata(metadataText);
  } catch (err) {
    const message =
      err instanceof InvalidMetadataError ? err.message : "Metadado inválido.";
    await recordError(supabase, pair.media.id, message);
    return;
  }

  let mediaBuffer: Buffer;
  try {
    mediaBuffer = await downloadFileContent(drive, pair.media.id);
  } catch (err) {
    console.error("Falha ao baixar a mídia do Drive (tenta de novo depois):", err);
    return;
  }

  const extension = pair.media.name.split(".").pop() ?? "bin";
  const storagePath = `${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("posts-media")
    .upload(storagePath, mediaBuffer, { contentType: pair.media.mimeType });

  if (uploadError) {
    console.error("Falha ao subir a mídia pro Storage (tenta de novo depois):", uploadError);
    return;
  }

  const match = await matchArtistAndAccount(
    supabase,
    metadata.artista,
    metadata.contaSocial
  );

  const { data: post, error: insertError } = await supabase
    .from("posts")
    .insert({
      artist_id: match.artistId,
      social_account_id: match.socialAccountId,
      post_type: metadata.tipo,
      source_fact: metadata.fato,
      track_name: metadata.musica,
      media_url: storagePath,
      media_type: mediaTypeFromMimeType(pair.media.mimeType),
      status: "pendente",
      ingestion_warning: match.warning,
    })
    .select("id")
    .single();

  if (insertError || !post) {
    await recordError(supabase, pair.media.id, "Falha ao criar o post no banco.");
    return;
  }

  await supabase
    .from("drive_ingestions")
    .insert({ drive_file_id: pair.media.id, post_id: post.id, status: "processado" });

  try {
    await moveToProcessed(drive, pair.media.id, processedFolderId, rootFolderId);
    await moveToProcessed(drive, pair.metadata.id, processedFolderId, rootFolderId);
  } catch (err) {
    console.error(
      "Falha ao mover arquivos para 'Processados' após criar o post (post já existe, não crítico):",
      err
    );
  }
}
```

**Passo 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros no arquivo novo.

**Passo de commit:**

```bash
git add lib/drive/ingestFile.ts
git commit -m "feat(drive): orquestração da ingestão de um par mídia+metadado"
```

---

### Task 9: Rota do cron e `vercel.json`

**Agent:** fullstack-developer

**Files:**
- Create: `app/api/cron/drive-ingest/route.ts`
- Create: `vercel.json`

**Passo 1: Criar `app/api/cron/drive-ingest/route.ts`**

```ts
import { NextResponse } from "next/server";

import { createDriveClient } from "@/lib/drive/client";
import { findOrCreateProcessedFolder } from "@/lib/drive/folders";
import { ingestFilePair } from "@/lib/drive/ingestFile";
import { listRootFiles } from "@/lib/drive/listPendingFiles";
import { pairFiles } from "@/lib/drive/pairFiles";
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

  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) {
    console.error("GOOGLE_DRIVE_FOLDER_ID não configurado.");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let drive;
  try {
    drive = createDriveClient();
  } catch (err) {
    console.error("Falha ao autenticar com o Google Drive:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let files;
  try {
    files = await listRootFiles(drive, rootFolderId);
  } catch (err) {
    console.error(
      "Falha ao listar arquivos do Drive (tenta de novo no próximo cron):",
      err
    );
    return NextResponse.json({ processed: 0 });
  }

  const pairs = pairFiles(files);
  if (pairs.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const processedFolderId = await findOrCreateProcessedFolder(drive, rootFolderId);
  const supabase = createServiceClient();

  for (const pair of pairs) {
    await ingestFilePair(drive, supabase, pair, processedFolderId, rootFolderId);
  }

  return NextResponse.json({ processed: pairs.length });
}
```

**Passo 2: Criar `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/drive-ingest",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

**Passo 3: Verificar tipos e lint**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run lint`
Expected: sem erros.

**Passo 4: Testar localmente sem autorização (deve rejeitar)**

Run: `npm run dev` (em um terminal separado, deixar rodando)

Run: `curl -i http://localhost:3000/api/cron/drive-ingest`
Expected: `HTTP/1.1 401` com `{"error":"unauthorized"}`.

**Passo de commit:**

```bash
git add "app/api/cron/drive-ingest/route.ts" vercel.json
git commit -m "feat(cron): rota de ingestão do Drive protegida por CRON_SECRET"
```

---

### Task 10: Kanban — coluna "Pendente (Drive)" e renderização null-safe

**Agent:** frontend-developer
**Skills de apoio:** `tailwind-patterns`

**Files:**
- Modify: `components/kanban/board.tsx`
- Modify: `components/kanban/post-card.tsx`

**Contexto:** Posts vindos do M3 chegam com `status = 'pendente'`, `template`/`headline`/`caption`/`social_account` nulos e possivelmente `ingestion_warning` preenchido. O board precisa de uma 5ª coluna e o card não pode quebrar renderizando esses campos.

**Passo 1: Editar `components/kanban/board.tsx`**

Trocar a linha do grid (linha 26):

```tsx
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
```

Por:

```tsx
    <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
```

(`POST_STATUSES` já tem 5 entradas desde a Task 3 — o `.map` já renderiza a coluna nova automaticamente.)

**Passo 2: Editar `components/kanban/post-card.tsx`**

Trocar o bloco do template (linhas 65-72):

```tsx
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {POST_TYPE_LABELS[post.post_type]}
        </span>
        <span className="text-xs text-muted-foreground">
          Template {post.template}
        </span>
      </div>
```

Por:

```tsx
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {POST_TYPE_LABELS[post.post_type]}
        </span>
        {post.template && (
          <span className="text-xs text-muted-foreground">
            Template {post.template}
          </span>
        )}
      </div>
```

Trocar o bloco de manchete/legenda (linhas 92-95):

```tsx
      <p className="text-sm font-semibold text-foreground">{post.headline}</p>
      <p className="line-clamp-3 text-xs text-muted-foreground">
        {post.caption}
      </p>
```

Por:

```tsx
      <p className="text-sm font-semibold text-foreground">
        {post.headline ?? "Aguardando manchete da IA (M4)"}
      </p>
      <p className="line-clamp-3 text-xs text-muted-foreground">
        {post.caption ?? "Aguardando legenda da IA (M4)"}
      </p>
```

Trocar o bloco de conta social/artista (linhas 97-103):

```tsx
      <p className="text-xs text-muted-foreground">
        {SOCIAL_NETWORK_LABELS[
          post.social_account.network as keyof typeof SOCIAL_NETWORK_LABELS
        ] ?? post.social_account.network}{" "}
        — {post.social_account.display_name}
        {post.artist && ` · ${post.artist.name} (${post.artist.handle})`}
      </p>
```

Por:

```tsx
      <p className="text-xs text-muted-foreground">
        {post.social_account
          ? `${
              SOCIAL_NETWORK_LABELS[
                post.social_account.network as keyof typeof SOCIAL_NETWORK_LABELS
              ] ?? post.social_account.network
            } — ${post.social_account.display_name}`
          : "Conta social não vinculada"}
        {post.artist && ` · ${post.artist.name} (${post.artist.handle})`}
      </p>
```

Adicionar o aviso de ingestão logo após o bloco de `rejection_reason` (depois da linha 109, antes da `div` de ações):

```tsx
      {post.ingestion_warning && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
          {post.ingestion_warning}
        </p>
      )}
```

**Passo 3: Verificar tipos e lint**

Run: `npx tsc --noEmit`
Expected: os erros da Task 3 relacionados a `post-card.tsx` desaparecem. Se sobrar algum erro em `post-form-dialog.tsx`, confirmar que já usa `post?.campo ?? ""` (deve compilar sem mudança — os `?? ""` já tratam `null`).

Run: `npm run lint`
Expected: sem erros.

**Passo 4: Conferir visualmente**

Run: `npm run dev`

Abrir `/conteudo` ou `/aprovacao` logado e confirmar que o board renderiza 5 colunas sem erro no console, mesmo sem nenhum post `pendente` ainda.

**Passo de commit:**

```bash
git add components/kanban/board.tsx components/kanban/post-card.tsx
git commit -m "feat(kanban): coluna Pendente (Drive) e renderização null-safe do card"
```

---

### Task 11: Atualizar `docs/DEPLOY.md` com o setup do M3

**Agent:** fullstack-developer

**Files:**
- Modify: `docs/DEPLOY.md`

**Passo 1: Adicionar uma seção nova ao final do arquivo**

```markdown
## Pós-M3: Service Account do Drive e cron de ingestão

1. No [Google Cloud Console](https://console.cloud.google.com), crie (ou reaproveite) um
   projeto, ative a **Google Drive API** e crie uma **Service Account** em
   **IAM & Admin > Service Accounts**.
2. Gere uma chave JSON para essa service account (**Keys > Add Key > JSON**) e baixe o
   arquivo.
3. Compartilhe a pasta do Drive usada para ingestão com o e-mail `client_email` do JSON
   (papel **Editor**).
4. Copie o conteúdo do JSON inteiro, em uma linha só, para `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`
   no `.env.local` e nas env vars da Vercel.
5. Preencha `GOOGLE_DRIVE_FOLDER_ID` com o ID da pasta (parte final da URL do Drive).
6. Gere um valor aleatório para `CRON_SECRET` (ex: `openssl rand -hex 32`) e configure na
   Vercel — isso ativa a proteção automática das chamadas de cron da própria Vercel.
7. Aplique a migration do M3:
   ```
   npx supabase db push
   ```
8. Depois do próximo deploy, o cron `/api/cron/drive-ingest` passa a rodar a cada 5
   minutos automaticamente (agendado em `vercel.json`) — sem nenhum passo manual adicional.
```

**Passo de commit:**

```bash
git add docs/DEPLOY.md
git commit -m "docs: setup da Service Account do Drive e do cron de ingestão (M3)"
```

---

### Task 12: Atualizar `PLAN.md`

**Agent:** fullstack-developer

**Files:**
- Modify: `PLAN.md:43-51`

**Passo 1: Editar a seção do M3**

Substituir:

```markdown
## M3 — Ingestão do Google Drive

**Objetivo**: conteúdo entra no sistema sem intervenção manual.

- Monitoramento da pasta acordada via Google Drive API.
- Detecção de arquivo novo + leitura de metadados (artista, música, fato — via nome do arquivo ou .txt junto).
- Post novo entra na fila com status "pendente" (sem manchete/legenda ainda).

**Pronto para avançar quando**: soltar um arquivo na pasta do Drive cria um post pendente no painel em poucos minutos.
```

Por:

```markdown
## M3 — Ingestão do Google Drive ✅ (código pronto, checklist manual pendente)

**Objetivo**: conteúdo entra no sistema sem intervenção manual.

- [x] Monitoramento da pasta acordada via Google Drive API — cron da Vercel a cada 5 minutos (`app/api/cron/drive-ingest`), autenticado via Service Account (`lib/drive/client.ts`).
- [x] Detecção de arquivo novo + leitura de metadados (artista, música, fato, conta social, tipo — via `.json` com o mesmo nome-base da mídia). Sem match de artista/conta social, o post é criado mesmo assim com `ingestion_warning` visível na fila (nunca falha em silêncio).
- [x] Post novo entra na fila com status "pendente" (sem manchete/legenda ainda — `source_fact`/`track_name` guardados para o M4 usar). Arquivos processados são movidos para a subpasta `Processados/` no Drive.

**Pronto para avançar quando**: soltar um arquivo na pasta do Drive cria um post pendente no painel em poucos minutos. *(Código commitado na `main`; falta rodar o checklist manual de `docs/plans/2026-07-03-m3-drive-ingestion.md` — Task 13 — contra uma pasta real do Drive e um projeto Supabase linkado: aplicar a migration `0003_drive_ingestion.sql`, configurar a Service Account e o `CRON_SECRET`, e soltar arquivos reais na pasta.)*
```

**Passo de commit:**

```bash
git add PLAN.md
git commit -m "docs: marcar M3 como código pronto, checklist manual pendente"
```

---

### Task 13: Checklist de teste manual ponta a ponta

**Agent:** (sessão principal, sem subagente — precisa de acesso a um Drive e Supabase reais que só o Victor tem)

**Pré-requisitos:**
- Migration `0003_drive_ingestion.sql` aplicada num projeto Supabase linkado.
- Service Account criada, pasta de ingestão compartilhada com ela, `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` e `GOOGLE_DRIVE_FOLDER_ID` configurados em `.env.local`.
- `CRON_SECRET` configurado em `.env.local`.
- Pelo menos um artista e uma conta social cadastrados em `/admin/artistas` e `/admin/contas` (do M2), pra poder testar o caso de match e o caso de não-match.

**Checklist:**

1. Rodar `npm run dev` e chamar manualmente a rota (simula o cron):
   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/drive-ingest
   ```
   Com a pasta vazia, esperado: `{"processed":0}`.

2. Soltar na pasta do Drive um par válido: uma imagem (`teste1.jpg`) + `teste1.json` com:
   ```json
   { "artista": "<nome de um artista já cadastrado>", "musica": "Faixa Teste", "fato": "Bateu 100 mil plays", "conta_social": "<handle de uma conta já cadastrada>", "tipo": "viral_geral" }
   ```
   Chamar a rota do cron de novo. Esperado: `{"processed":1}`, e os dois arquivos aparecem movidos para `Processados/` no Drive.

3. Abrir o painel (`/conteudo` ou `/aprovacao`) logado e confirmar: o post aparece na coluna "Pendente (Drive)", com a imagem carregando, "Aguardando manchete da IA (M4)" no lugar da manchete, e a conta social/artista corretos exibidos.

4. Soltar um segundo par com `conta_social` e `artista` que **não** existem cadastrados. Chamar a rota de novo. Esperado: post criado do mesmo jeito, com aviso `"artista não encontrado: ...; conta social não encontrada: ..."` visível em destaque amarelo no card.

5. Soltar só uma mídia sem o `.json` correspondente. Chamar a rota. Esperado: `{"processed":0}` (ou sem incremento) — nenhum post novo, arquivo continua na pasta raiz (não vai pra `Processados`). Depois, soltar o `.json` fio e chamar a rota de novo — o par completa e processa normalmente.

6. Soltar um `.json` malformado (JSON inválido) junto de uma mídia. Chamar a rota. Esperado: nenhum post criado, os arquivos continuam na pasta raiz, e uma linha aparece em `drive_ingestions` com `status = 'erro'` (conferir via SQL Editor do Supabase: `select * from drive_ingestions order by created_at desc;`).

7. Chamar a rota do cron de novo sem soltar nada de novo na pasta (idempotência). Esperado: `{"processed":0}`, nenhum post duplicado.

**Se todos os passos passarem:** marcar em `PLAN.md` que o checklist manual do M3 foi concluído (trocar a nota entre parênteses do milestone).

---

## Ordem de execução e dependências

Tasks 1-9 são sequenciais (schema → tipos → env → lib/drive em camadas → rota). Task 10 depende dos tipos da Task 3. Tasks 11-12 são documentação, podem rodar em paralelo com qualquer task de código depois da Task 9. Task 13 só roda depois de tudo commitado, contra ambiente real.
