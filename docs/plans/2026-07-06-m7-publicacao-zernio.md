# M7 — Publicação via Zernio — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Um post `aprovado` no painel é publicado automaticamente (assim que possível, ou no `scheduled_at` agendado) via Zernio, o status vira `publicado` com link do post no ar — mantendo a camada de publicação isolada para trocar de agregador ser um ajuste de horas, não um redesenho.

**Architecture:** Novo módulo `lib/publishing/` isola qualquer chamada ao Zernio atrás da interface `PublishingProvider`; como não há doc real da API do Zernio ainda, a implementação é um stub best-effort (REST + API key) claramente isolado, para trocar por uma chamada real sem tocar no resto do app. Um novo cron `publish-scheduled` (mesmo padrão de auth/erro dos crons existentes) busca posts `aprovado` com arte pronta e agendamento vencido (ou sem agendamento) e publica; falha nunca é silenciosa (`publish_error`, sem retry automático — mesmo padrão de `art_generation_error`). `social_accounts` ganha `zernio_account_id` para saber em qual conta publicar.

**Tech Stack:** Next.js server actions, Supabase Postgres + RLS, Vercel Cron, `fetch` nativo (sem SDK novo — API do Zernio é HTTP simples).

**Nota sobre verificação:** mesma convenção dos milestones anteriores (M1-M6) — sem suite de testes automatizados; cada task termina em `npm run lint && npx tsc --noEmit` (e `npm run build` nas tasks que tocam rotas/crons). O teste manual fica registrado na Task 8 como checklist pendente (não pode ser validado neste sandbox sem conta real no Zernio, mesma limitação de todos os milestones).

**Referência de spec:** [docs/superpowers/specs/2026-07-06-m7-publicacao-zernio-design.md](../superpowers/specs/2026-07-06-m7-publicacao-zernio-design.md)

---

### Task 1: Migration `0008_publishing.sql`

**Files:**
- Create: `supabase/migrations/0008_publishing.sql`

**Step 1: Escrever a migration**

```sql
-- M7: publicação via Zernio. Adiciona 'publicado' ao ciclo de vida do post,
-- rastreio de resultado (published_at/post_url) e erro (publish_error,
-- mesmo padrão de art_generation_error/copy_generation_error — nunca falha
-- em silêncio). social_accounts ganha a referência da conta no Zernio,
-- necessária para saber em qual conta publicar.

alter table public.posts
  drop constraint posts_status_check;

alter table public.posts
  add constraint posts_status_check
  check (status in ('pendente', 'rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado', 'publicado'));

alter table public.posts
  add column published_at timestamptz,
  add column post_url text,
  add column publish_error text;

alter table public.social_accounts
  add column zernio_account_id text;
```

**Step 2: Validar contra um projeto linkado (se houver) ou só a sintaxe**

Run: `npx supabase db push` (se houver projeto linkado) ou revisão manual do SQL acima — mesmo sandbox sem Supabase linkado dos milestones anteriores.

**Step 3: Commit**

```bash
git add supabase/migrations/0008_publishing.sql
git commit -m "feat(m7): adiciona status publicado e colunas de resultado/erro de publicacao"
```

---

### Task 2: Tipos — `lib/types/post.ts` e `lib/types/social-account.ts`

**Files:**
- Modify: `lib/types/post.ts`
- Modify: `lib/types/social-account.ts`

**Step 1:** Em `lib/types/post.ts`, adicionar `"publicado"` a `POST_STATUSES` e `POST_STATUS_LABELS`:

```ts
export const POST_STATUSES = [
  "pendente",
  "rascunho",
  "pendente_aprovacao",
  "aprovado",
  "rejeitado",
  "publicado",
] as const;
```

```ts
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  pendente: "Pendente (Drive)",
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente de aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  publicado: "Publicado",
};
```

**Step 2:** Adicionar os 3 campos novos à interface `Post` (mesmo padrão de `art_generation_error`):

```ts
/** Preenchido pelo M7 quando o post é publicado com sucesso via Zernio. */
published_at: string | null;
/** Preenchido pelo M7: link do post publicado. */
post_url: string | null;
/** Preenchido pelo M7 quando a publicação falha — nunca falha em silêncio. */
publish_error: string | null;
```

**Step 3:** Em `lib/types/social-account.ts`, adicionar o campo à interface `SocialAccount`:

```ts
export interface SocialAccount {
  id: string;
  network: SocialNetwork;
  handle: string;
  display_name: string;
  /** Preenchido pelo M7: referência da conta no Zernio (necessária para publicar). */
  zernio_account_id: string | null;
  created_at: string;
}
```

**Step 4: Rodar checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos (select `*` já traz as colunas — só o tipo TS precisa refletir).

**Step 5: Commit**

```bash
git add lib/types/post.ts lib/types/social-account.ts
git commit -m "feat(m7): adiciona status publicado e campos de publicacao aos tipos"
```

---

### Task 3: Camada de publicação isolada — `lib/publishing/`

**Files:**
- Create: `lib/publishing/types.ts`
- Create: `lib/publishing/zernio.ts`
- Create: `lib/publishing/index.ts`
- Modify: `.env.example`

**Step 1: Tipos e erro da camada**

```ts
// lib/publishing/types.ts
export interface PublishInput {
  postId: string;
  zernioAccountId: string;
  mediaUrl: string;
  caption: string;
}

export interface PublishResult {
  postUrl: string;
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Lançado por qualquer PublishingProvider em falha — nunca lança erro genérico. */
export class PublishError extends Error {}
```

**Step 2: Implementação stub do Zernio**

Sem doc real da API do Zernio disponível ainda (ver spec) — este cliente assume um formato REST razoável (API key + `POST /posts`) e fica isolado atrás da interface acima. Ajustar contra a doc real é trocar só este arquivo.

```ts
// lib/publishing/zernio.ts
import type { PublishInput, PublishingProvider, PublishResult } from "./types";
import { PublishError } from "./types";

export class ZernioProvider implements PublishingProvider {
  async publish(input: PublishInput): Promise<PublishResult> {
    const apiKey = process.env.ZERNIO_API_KEY;
    const baseUrl = process.env.ZERNIO_API_BASE_URL;

    if (!apiKey || !baseUrl) {
      throw new PublishError(
        "ZERNIO_API_KEY ou ZERNIO_API_BASE_URL não configurados."
      );
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_id: input.zernioAccountId,
          media_url: input.mediaUrl,
          caption: input.caption,
        }),
      });
    } catch {
      throw new PublishError("Falha de rede ao chamar a API do Zernio.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PublishError(
        `Zernio retornou ${response.status}: ${body || "sem detalhes"}.`
      );
    }

    const data = (await response.json().catch(() => null)) as
      | { url?: string }
      | null;

    if (!data?.url) {
      throw new PublishError(
        "Resposta do Zernio sem o link do post publicado."
      );
    }

    return { postUrl: data.url };
  }
}
```

**Step 3: Ponto único de troca de provedor**

```ts
// lib/publishing/index.ts
import type { PublishingProvider } from "./types";
import { ZernioProvider } from "./zernio";

export function getPublishingProvider(): PublishingProvider {
  return new ZernioProvider();
}

export type { PublishInput, PublishResult, PublishingProvider } from "./types";
export { PublishError } from "./types";
```

**Step 4: Documentar a env var nova**

Adicionar em `.env.example`, logo abaixo de `ZERNIO_API_KEY=`:

```
# URL base da API do Zernio (formato assumido — ajustar quando a doc real
# estiver disponível, ver docs/superpowers/specs/2026-07-06-m7-publicacao-zernio-design.md)
ZERNIO_API_BASE_URL=
```

**Step 5: Rodar lint/tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: limpo.

**Step 6: Commit**

```bash
git add lib/publishing .env.example
git commit -m "feat(m7): camada de publicacao isolada com stub do Zernio"
```

---

### Task 4: Query de posts elegíveis para publicação — `lib/posts/pendingPublish.ts`

Mesmo padrão de `lib/posts/pendingArt.ts`.

**Files:**
- Create: `lib/posts/pendingPublish.ts`

**Step 1: Escrever a query**

```ts
// lib/posts/pendingPublish.ts
import { createServiceClient } from "@/lib/supabase/service";

export interface PostPendingPublish {
  id: string;
  caption: string;
  rendered_art_url: string;
  social_account: { zernio_account_id: string | null } | null;
}

export async function listPostsPendingPublish(): Promise<
  PostPendingPublish[]
> {
  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, caption, rendered_art_url, social_account:social_accounts(zernio_account_id)"
    )
    .eq("status", "aprovado")
    .eq("media_type", "image")
    .not("rendered_art_url", "is", null)
    .is("publish_error", null)
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);

  if (error) {
    console.error(
      "[pendingPublish] falha ao buscar posts pendentes de publicação:",
      error.message
    );
    return [];
  }

  return (data ?? []) as unknown as PostPendingPublish[];
}
```

**Step 2: Rodar lint/tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: limpo.

**Step 3: Commit**

```bash
git add lib/posts/pendingPublish.ts
git commit -m "feat(m7): query de posts aprovados elegiveis para publicacao"
```

---

### Task 5: Cron de publicação — `app/api/cron/publish-scheduled/route.ts`

Segue exatamente o padrão de `app/api/cron/generate-art/route.ts` (auth via `CRON_SECRET`, falha fechada, service client, gera a URL assinada da arte para enviar ao Zernio — o bucket `posts-media` é privado, então a `media_url`/`rendered_art_url` gravada é só o path interno).

**Files:**
- Create: `app/api/cron/publish-scheduled/route.ts`
- Modify: `vercel.json`

**Step 1: Escrever a rota**

```ts
// app/api/cron/publish-scheduled/route.ts
import { NextResponse } from "next/server";
import { getPublishingProvider, PublishError } from "@/lib/publishing";
import { listPostsPendingPublish } from "@/lib/posts/pendingPublish";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function recordPublishError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ publish_error: message })
    .eq("id", postId);
  if (error) {
    console.error(
      `[publish-scheduled] falha ao gravar publish_error do post ${postId}:`,
      error.message
    );
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pending = await listPostsPendingPublish();
  const supabase = createServiceClient();
  const provider = getPublishingProvider();
  let published = 0;

  for (const post of pending) {
    const zernioAccountId = post.social_account?.zernio_account_id ?? null;
    if (!zernioAccountId) {
      await recordPublishError(
        post.id,
        "Conta social sem zernio_account_id configurado (ver /admin/contas)."
      );
      continue;
    }

    const { data: signedUrl, error: signError } = await supabase.storage
      .from("posts-media")
      .createSignedUrl(post.rendered_art_url, 60 * 10);

    if (signError || !signedUrl?.signedUrl) {
      await recordPublishError(
        post.id,
        "Falha ao gerar URL assinada da arte para publicação."
      );
      continue;
    }

    try {
      const { postUrl } = await provider.publish({
        postId: post.id,
        zernioAccountId,
        mediaUrl: signedUrl.signedUrl,
        caption: post.caption,
      });

      const { error } = await supabase
        .from("posts")
        .update({
          status: "publicado",
          published_at: new Date().toISOString(),
          post_url: postUrl,
        })
        .eq("id", post.id);

      if (error) {
        console.error(
          `[publish-scheduled] falha ao gravar publicacao do post ${post.id}:`,
          error.message
        );
        continue;
      }
      published += 1;
    } catch (err) {
      const message =
        err instanceof PublishError
          ? err.message
          : "Erro inesperado ao publicar via Zernio.";
      await recordPublishError(post.id, message);
    }
  }

  return NextResponse.json({ published, total: pending.length });
}
```

**Step 2: Registrar o cron no `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/drive-ingest", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/generate-copy", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/generate-art", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/sla-alert", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/publish-scheduled", "schedule": "*/5 * * * *" }
  ]
}
```

**Step 3: Rodar lint/tsc/build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: limpo.

**Step 4: Commit**

```bash
git add app/api/cron/publish-scheduled/route.ts vercel.json
git commit -m "feat(m7): cron de publicacao agendada via Zernio"
```

---

### Task 6: Ação manual "Tentar publicar novamente" — `lib/posts/actions.ts`

**Files:**
- Modify: `lib/posts/actions.ts`

**Step 1:** Adicionar a ação, mesmo padrão de `regenerateArt` (limpa o erro para o post voltar a ser elegível na query do cron):

```ts
export async function retryPublish(postId: string, _formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update({ publish_error: null })
    .eq("id", postId)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error(
      "Falha ao limpar publish_error (bloqueado por RLS ou erro do Supabase):",
      postId,
      error
    );
    return;
  }

  revalidatePostPages();
}
```

**Step 2: Rodar lint/tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: limpo.

**Step 3: Commit**

```bash
git add lib/posts/actions.ts
git commit -m "feat(m7): acao manual para tentar publicar novamente apos falha"
```

---

### Task 7: UI do Kanban — aviso de erro, link do post publicado e botão de retry

**Files:**
- Modify: `components/kanban/post-card.tsx`
- Modify: `components/kanban/board.tsx` (só precisa continuar funcionando com o novo status — já é data-driven por `POST_STATUSES`, conferir o grid)

**Step 1:** Em `post-card.tsx`, adicionar a função de permissão (mesmo espírito de `canDecide`, mas para o dono da decisão de publicação — `aprovador`/`admin`, únicos papéis que decidem hoje):

```ts
function canRetryPublish(post: PostWithRelations, role: Role) {
  return (
    (role === "aprovador" || role === "admin") &&
    post.status === "aprovado" &&
    Boolean(post.publish_error)
  );
}
```

**Step 2:** Importar `retryPublish` de `@/lib/posts/actions` no topo do arquivo (junto aos demais imports de actions).

**Step 3:** Adicionar o aviso de erro, logo abaixo do bloco de `notification_error` (linha ~180):

```tsx
{post.publish_error && (
  <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
    Falha ao publicar: {post.publish_error}
  </p>
)}
```

**Step 4:** Adicionar o link do post publicado, logo abaixo do bloco de `social_account`/`artist` (linha ~150):

```tsx
{post.status === "publicado" && post.post_url && (
  <a
    href={post.post_url}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-primary underline"
  >
    Ver post publicado
    {post.published_at &&
      ` — ${new Date(post.published_at).toLocaleString("pt-BR")}`}
  </a>
)}
```

**Step 5:** Adicionar o botão de retry no bloco de ações (ao lado de `RejectDialog`):

```tsx
{canRetryPublish(post, role) && (
  <form action={retryPublish.bind(null, post.id)}>
    <Button type="submit" size="sm" variant="outline">
      Tentar publicar novamente
    </Button>
  </form>
)}
```

**Step 6:** Conferir `board.tsx` — o grid usa `md:grid-cols-5` fixo; com `publicado` agora são 6 colunas. Atualizar para `md:grid-cols-6` (ou considerar `lg:grid-cols-6` mantendo `md:grid-cols-3` para não espremer demais em telas médias — decisão de ajuste fino na hora, seguindo o espírito responsivo já usado no restante do painel).

**Step 7: Rodar lint/tsc/build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: limpo.

**Step 8: Commit**

```bash
git add components/kanban/post-card.tsx components/kanban/board.tsx
git commit -m "feat(m7): mostra status publicado, erro de publicacao e retry manual no kanban"
```

---

### Task 8: Admin — `zernio_account_id` em `/admin/contas`

**Files:**
- Modify: `app/(dashboard)/admin/contas/actions.ts`
- Modify: `app/(dashboard)/admin/contas/social-account-form.tsx`
- Modify: `app/(dashboard)/admin/contas/page.tsx`

**Step 1:** Em `actions.ts`, aceitar o campo opcional na criação e adicionar uma ação de atualização (contas já existentes precisam poder receber o ID depois, sem recriar):

```ts
export async function createSocialAccount(
  _prevState: SocialAccountFormState,
  formData: FormData
): Promise<SocialAccountFormState> {
  const network = String(formData.get("network") ?? "") as SocialNetwork;
  const handle = String(formData.get("handle") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const zernioAccountId =
    (formData.get("zernio_account_id") as string)?.trim() || null;

  if (!SOCIAL_NETWORKS.includes(network) || !handle || !displayName) {
    return { error: "Preencha rede, @handle e nome de exibição." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("social_accounts").insert({
    network,
    handle,
    display_name: displayName,
    zernio_account_id: zernioAccountId,
  });

  if (error) {
    return { error: "Não foi possível salvar a conta social." };
  }

  revalidatePath("/admin/contas");
  return undefined;
}

export async function updateZernioAccountId(
  accountId: string,
  formData: FormData
) {
  const zernioAccountId =
    (formData.get("zernio_account_id") as string)?.trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .update({ zernio_account_id: zernioAccountId })
    .eq("id", accountId);

  if (error) {
    console.error("Falha ao atualizar zernio_account_id:", accountId, error);
  }
  revalidatePath("/admin/contas");
}
```

**Step 2:** Em `social-account-form.tsx`, adicionar o campo opcional no formulário de criação (mesmo padrão dos demais inputs):

```tsx
<div className="flex flex-col gap-1.5">
  <label
    htmlFor="zernio_account_id"
    className="text-sm text-muted-foreground"
  >
    ID da conta no Zernio (opcional)
  </label>
  <input
    id="zernio_account_id"
    name="zernio_account_id"
    placeholder="Preencher depois de conectar no Zernio"
    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
  />
</div>
```

**Step 3:** Em `page.tsx`, adicionar a coluna com um input inline + botão salvar por linha (contas já existentes, sem esse campo, precisam poder recebê-lo depois):

```tsx
<th className="py-2">ID Zernio</th>
```

```tsx
<td className="py-2">
  <form
    action={updateZernioAccountId.bind(null, account.id)}
    className="flex items-center gap-2"
  >
    <input
      name="zernio_account_id"
      defaultValue={account.zernio_account_id ?? ""}
      placeholder="—"
      className="w-32 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
    />
    <Button type="submit" variant="ghost" size="sm">
      Salvar
    </Button>
  </form>
</td>
```

(Importar `updateZernioAccountId` de `./actions` junto com `deleteSocialAccount`.)

**Step 4: Rodar lint/tsc/build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: limpo.

**Step 5: Commit**

```bash
git add app/\(dashboard\)/admin/contas
git commit -m "feat(m7): configuracao do id da conta no zernio em admin/contas"
```

---

### Task 9: Checklist manual + atualizar `PLAN.md`

**Files:**
- Modify: `PLAN.md` (seção M7)

**Step 1:** Registrar o checklist manual (não pode ser validado neste sandbox sem conta real no Zernio, mesma limitação de todos os milestones):

1. Configurar `ZERNIO_API_KEY`/`ZERNIO_API_BASE_URL` reais e `zernio_account_id` de uma conta Instagram conectada.
2. Aprovar um post com arte pronta e sem `scheduled_at` → confirmar publicação no próximo ciclo do cron (`status = publicado`, `post_url`/`published_at` preenchidos, link abre o post real).
3. Aprovar um post com `scheduled_at` no futuro → confirmar que não publica antes da hora.
4. Aprovar um post numa conta sem `zernio_account_id` → `publish_error` visível, status continua `aprovado`.
5. Forçar uma falha do provedor (API key inválida) → `publish_error` visível; clicar "Tentar publicar novamente" → erro some e o cron tenta de novo no próximo ciclo.
6. Confirmar que o board do Kanban renderiza as 6 colunas corretamente em desktop e mobile.

**Step 2:** Atualizar a entrada `## M7` do `PLAN.md` para `✅ (código pronto, checklist manual pendente)`, seguindo exatamente o texto/formatação dos milestones M1-M6, linkando este plano e a spec.

**Step 3: Commit e push** (conforme `docs/CLAUDE.md`, push para `main` faz parte do fluxo normal após cada commit)

```bash
git add PLAN.md
git commit -m "docs: marca M7 como codigo pronto, checklist manual pendente"
git push origin main
```

---

## Débito técnico conhecido a documentar no `PLAN.md` (baixa prioridade, não bloqueia M8)

- Cliente Zernio (`lib/publishing/zernio.ts`) é um stub best-effort sem validação contra a API real — formato de request/response pode precisar de ajuste quando a doc oficial estiver disponível (mesmo espírito do checklist manual do Supabase, registrado como pendência conhecida).
- Sem alerta ativo (e-mail/monitoramento) quando uma conta social desconecta ou uma publicação falha repetidamente — só o aviso visível no card. Fica para o M9, que já é o milestone dedicado a isso.
- Sem fluxo de "despublicar" ou cancelar um post agendado que ainda não publicou além de editar/rejeitar antes do cron rodar.
- Publicação em TikTok/YouTube/Facebook fora de escopo (Instagram primeiro, mesma decisão do M6).
