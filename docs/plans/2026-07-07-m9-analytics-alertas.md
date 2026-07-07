# M9 — Analytics e alertas de conexão — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Coleta periódica de métricas por post publicado (curtidas/comentários/alcance) via um stub best-effort da API do Zernio, um dashboard comparativo por conta/artista/horário, e um alerta ativo por e-mail quando uma conta social parece ter desconectado (detectado por falhas consecutivas de publicação, sem endpoint de status dedicado do Zernio).

**Architecture:** Nova tabela `post_metrics` (uma linha por post publicado, upsert a cada coleta) e três colunas novas em `social_accounts` (`connection_status`, `consecutive_publish_failures`, `disconnected_alert_sent_at`). `PublishingProvider` (M7) ganha `getMetrics()`, implementado como stub no `ZernioProvider`, isolado atrás da mesma abstração usada para `publish()`. Um novo cron `collect-metrics` (`*/30 * * * *`) preenche `post_metrics`. O cron `publish-scheduled` (M7, já existente) passa a atualizar o contador de falhas de cada conta a cada tentativa e a disparar e-mail de alerta ao cruzar o limiar. O dashboard (`/dashboard`) ganha uma nova seção de métricas agregadas.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS + service-role), Vercel Cron, Resend (e-mail). Sem framework de testes automatizado no projeto (confirmado em `package.json`); verificação de cada task usa `npx tsc --noEmit` + `npm run lint`, com checklist manual documentado no fim (mesmo padrão de M0–M8).

**Nota de adaptação ao processo:** este projeto não tem `pytest`/`vitest`/`jest` configurado — os passos "escreva o teste" do template padrão da skill são substituídos por "escreva a mudança + rode `tsc`/`lint`", seguindo o padrão real já usado em M2–M8 (revisão de código + checklist manual, não TDD automatizado).

**Spec de referência:** [docs/superpowers/specs/2026-07-07-m9-analytics-alertas-design.md](../superpowers/specs/2026-07-07-m9-analytics-alertas-design.md).

---

### Task 1: Migration — `post_metrics` e colunas de conexão em `social_accounts`

**Files:**
- Create: `supabase/migrations/0010_analytics.sql`

**Step 1: Escrever a migration**

```sql
-- M9: métricas por post publicado (coleta periódica via Zernio) e alerta de
-- desconexão de conta social — sinal indireto via falhas consecutivas de
-- publicação, sem endpoint de status dedicado do Zernio (não existe doc
-- oficial ainda). Ver docs/superpowers/specs/2026-07-07-m9-analytics-alertas-design.md.
create table public.post_metrics (
  post_id uuid primary key references public.posts (id),
  likes integer,
  comments integer,
  reach integer,
  collected_at timestamptz not null default now(),
  -- Nunca falha em silêncio: falha na coleta grava o motivo aqui, mesmo
  -- padrão de art_generation_error/publish_error. As últimas métricas boas
  -- conhecidas (likes/comments/reach) são preservadas, não zeradas.
  metrics_error text
);

alter table public.post_metrics enable row level security;

-- Qualquer papel autenticado vê as métricas (mesmo padrão de posts_select_authenticated).
create policy "post_metrics_select_authenticated"
  on public.post_metrics for select
  using (auth.uid() is not null);

-- Sem policy de insert/update para usuários autenticados: só o cron
-- collect-metrics (service-role, ignora RLS) escreve nesta tabela.

alter table public.social_accounts
  add column connection_status text not null default 'conectada'
    check (connection_status in ('conectada', 'desconectada')),
  add column consecutive_publish_failures integer not null default 0,
  add column disconnected_alert_sent_at timestamptz;
```

**Step 2: Rodar `npx tsc --noEmit` e `npm run lint`**

Não deve haver erro relacionado (a migration não é compilada por TS/ESLint).

**Step 3: Commit**

```bash
git add supabase/migrations/0010_analytics.sql
git commit -m "feat(m9): adiciona post_metrics e colunas de conexao em social_accounts"
```

---

### Task 2: Tipos — `PostMetrics` e campos de conexão

**Files:**
- Modify: `lib/types/social-account.ts`
- Modify: `lib/demo/mockData.ts` (só se `tsc` acusar erro)

**Step 1: Adicionar os campos em `lib/types/social-account.ts`**

```ts
export const CONNECTION_STATUSES = ["conectada", "desconectada"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
```

No `interface SocialAccount`, depois de `acervo_daily_slots`:

```ts
  /** Preenchido pelo M9: sinalizado via falhas consecutivas de publicação (sem endpoint de status do Zernio). */
  connection_status: ConnectionStatus;
  /** Preenchido pelo M9: zerado a cada publicação bem-sucedida na conta. */
  consecutive_publish_failures: number;
  /** Preenchido pelo M9: idempotência do alerta de desconexão. */
  disconnected_alert_sent_at: string | null;
```

**Step 2: Rodar `npx tsc --noEmit`**

Espera-se erro em `lib/demo/mockData.ts` (`DEMO_SOCIAL_ACCOUNTS: SocialAccount[]` sem os 3 campos novos) — corrigir no próximo passo.

**Step 3: Corrigir `lib/demo/mockData.ts`**

Adicionar aos objetos de `DEMO_SOCIAL_ACCOUNTS`:

```ts
    connection_status: "conectada",
    consecutive_publish_failures: 0,
    disconnected_alert_sent_at: null,
```

(esse arquivo é local/não commitado — mantê-lo consistente evita quebrar o modo demo usado para testar a UI sem Supabase real.)

**Step 4: Rodar `npx tsc --noEmit` de novo até limpar**

**Step 5: Commit**

```bash
git add lib/types/social-account.ts
git commit -m "feat(m9): adiciona tipos de status de conexao em SocialAccount"
```

---

### Task 3: `PublishingProvider.getMetrics` (stub best-effort)

**Files:**
- Modify: `lib/publishing/types.ts`
- Modify: `lib/publishing/zernio.ts`
- Modify: `lib/publishing/index.ts`

**Step 1: Adicionar `PostMetrics` e o método na interface**

Em `lib/publishing/types.ts`:

```ts
export interface PostMetrics {
  likes: number | null;
  comments: number | null;
  reach: number | null;
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
  /** Lança PublishError em qualquer falha — nunca retorna dado parcial silenciosamente. */
  getMetrics(postUrl: string): Promise<PostMetrics>;
}
```

**Step 2: Implementar o stub em `ZernioProvider`**

Em `lib/publishing/zernio.ts`, adicionar o método à classe (mesmo padrão de validação de env vars e tratamento de erro de `publish`):

```ts
  async getMetrics(postUrl: string): Promise<PostMetrics> {
    const apiKey = process.env.ZERNIO_API_KEY;
    const baseUrl = process.env.ZERNIO_API_BASE_URL;

    if (!apiKey || !baseUrl) {
      throw new PublishError(
        "ZERNIO_API_KEY ou ZERNIO_API_BASE_URL não configurados."
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/posts/metrics?url=${encodeURIComponent(postUrl)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
    } catch {
      throw new PublishError("Falha de rede ao chamar a API do Zernio.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PublishError(
        `Zernio retornou ${response.status}: ${body || "sem detalhes"}.`
      );
    }

    const data = (await response.json().catch(() => null)) as {
      likes?: number;
      comments?: number;
      reach?: number;
    } | null;

    if (!data) {
      throw new PublishError("Resposta do Zernio sem dados de métricas.");
    }

    return {
      likes: data.likes ?? null,
      comments: data.comments ?? null,
      reach: data.reach ?? null,
    };
  }
```

Adicionar `PostMetrics` ao import de `./types` no topo do arquivo.

**Step 3: Reexportar o tipo em `lib/publishing/index.ts`**

```diff
-export type { PublishInput, PublishResult, PublishingProvider } from "./types";
+export type {
+  PublishInput,
+  PublishResult,
+  PublishingProvider,
+  PostMetrics,
+} from "./types";
```

**Step 4: Rodar `npx tsc --noEmit` e `npm run lint`**

**Step 5: Commit**

```bash
git add lib/publishing/types.ts lib/publishing/zernio.ts lib/publishing/index.ts
git commit -m "feat(m9): adiciona getMetrics stub ao PublishingProvider"
```

---

### Task 4: Constante do limiar de desconexão

**Files:**
- Create: `lib/analytics/constants.ts`

**Step 1: Criar o arquivo**

```ts
/**
 * Número de falhas consecutivas de publicação numa conta social que marca
 * connection_status='desconectada' e dispara o alerta por e-mail. Constante
 * de código (não configurável por admin) por decisão do design — ver
 * docs/superpowers/specs/2026-07-07-m9-analytics-alertas-design.md.
 */
export const DISCONNECT_FAILURE_THRESHOLD = 3;

/** Janela de coleta de métricas: posts publicados há mais tempo que isso param de ser consultados no Zernio. */
export const METRICS_COLLECTION_WINDOW_DAYS = 30;
```

**Step 2: Commit**

```bash
git add lib/analytics/constants.ts
git commit -m "feat(m9): adiciona constantes de limiar de desconexao e janela de metricas"
```

---

### Task 5: Extrair destinatários de e-mail em módulo compartilhado (DRY)

O alerta de desconexão precisa da mesma lista de destinatários (`aprovador`+`admin`) que `notifyApprovers.ts` já busca. Extrair antes de duplicar.

**Files:**
- Create: `lib/email/recipients.ts`
- Modify: `lib/email/notifyApprovers.ts`

**Step 1: Criar `lib/email/recipients.ts`**

```ts
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Busca e-mails de todos os usuários aprovador/admin. Usa o cliente
 * service-role pelo mesmo motivo de notifyApprovers.ts: a policy
 * profiles_select_own_or_admin bloqueia esta leitura em nome do usuário
 * logado — é uma notificação de sistema.
 */
export async function getApproverAndAdminEmails(): Promise<
  { emails: string[] } | { error: string }
> {
  const supabase = createServiceClient();
  const { data: recipients, error } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["aprovador", "admin"]);

  if (error) {
    return { error: `Falha ao buscar destinatários da notificação: ${error.message}` };
  }
  if (!recipients || recipients.length === 0) {
    return { error: "Nenhum aprovador/admin cadastrado para notificar." };
  }

  return { emails: recipients.map((r) => r.email) };
}
```

**Step 2: Refatorar `notifyApprovers.ts` para usar o helper**

Substituir o bloco de busca de destinatários (linhas 40-51 atuais) por:

```ts
    const recipients = await getApproverAndAdminEmails();
    if ("error" in recipients) {
      return recipients.error;
    }
```

E trocar `recipients.map((r) => r.email)` (linha 64 atual) por `recipients.emails` na chamada de `resend.emails.send`. Adicionar o import:

```ts
import { getApproverAndAdminEmails } from "./recipients";
```

Remover o import de `createServiceClient` se ficar sem uso no arquivo.

**Step 3: Rodar `npx tsc --noEmit` e `npm run lint`**

Comportamento deve ficar idêntico (só extração).

**Step 4: Commit**

```bash
git add lib/email/recipients.ts lib/email/notifyApprovers.ts
git commit -m "refactor(m9): extrai busca de destinatarios aprovador/admin para lib/email/recipients.ts"
```

---

### Task 6: Template e função de alerta de desconexão

**Files:**
- Modify: `lib/email/templates.ts`
- Create: `lib/email/notifyAccountDisconnected.ts`

**Step 1: Adicionar os templates**

Em `lib/email/templates.ts`, seguindo o mesmo padrão de escape de `slaAlertSubject`/`slaAlertBody`:

```ts
export function accountDisconnectedSubject(accountLabel: string) {
  return `🔌 Conta social possivelmente desconectada: ${sanitizeSubjectText(accountLabel)}`;
}

export function accountDisconnectedBody(accountLabel: string) {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/contas`;
  const safeLabel = escapeHtml(accountLabel);
  return `<p>A conta <strong>${safeLabel}</strong> falhou ao publicar ${DISCONNECT_FAILURE_THRESHOLD_LABEL} vezes seguidas — possível desconexão no Zernio.</p><p><a href="${url}">Abrir /admin/contas</a></p>`;
}
```

Onde `DISCONNECT_FAILURE_THRESHOLD_LABEL` é o limiar interpolado como texto — importar `DISCONNECT_FAILURE_THRESHOLD` de `@/lib/analytics/constants` no topo do arquivo e usar diretamente:

```ts
import { DISCONNECT_FAILURE_THRESHOLD } from "@/lib/analytics/constants";
```

```diff
-  return `<p>A conta <strong>${safeLabel}</strong> falhou ao publicar ${DISCONNECT_FAILURE_THRESHOLD_LABEL} vezes seguidas — possível desconexão no Zernio.</p><p><a href="${url}">Abrir /admin/contas</a></p>`;
+  return `<p>A conta <strong>${safeLabel}</strong> falhou ao publicar ${DISCONNECT_FAILURE_THRESHOLD} vezes seguidas — possível desconexão no Zernio.</p><p><a href="${url}">Abrir /admin/contas</a></p>`;
```

**Step 2: Criar `lib/email/notifyAccountDisconnected.ts`**

Mesmo padrão de `notifyApprovers.ts`: nunca lança, retorna `string | null` (mensagem de erro ou `null` em sucesso).

```ts
import { getResendClient, EMAIL_FROM } from "./client";
import { getApproverAndAdminEmails } from "./recipients";
import { accountDisconnectedSubject, accountDisconnectedBody } from "./templates";

/**
 * Notifica aprovadores/admin quando uma conta social atinge o limiar de
 * falhas consecutivas de publicação. Nunca lança — qualquer falha (env var
 * ausente, erro de banco, erro do Resend) vira uma string de erro, sem
 * derrubar o cron de publicação que chamou esta função.
 */
export async function notifyAccountDisconnected(
  accountLabel: string
): Promise<string | null> {
  try {
    const resend = getResendClient();
    if (!resend) {
      return "RESEND_API_KEY não configurada — alerta de desconexão não enviado.";
    }

    const recipients = await getApproverAndAdminEmails();
    if ("error" in recipients) {
      return recipients.error;
    }

    const { error: sendError } = await resend.emails.send({
      from: EMAIL_FROM,
      to: recipients.emails,
      subject: accountDisconnectedSubject(accountLabel),
      html: accountDisconnectedBody(accountLabel),
    });

    if (sendError) {
      return `Falha ao enviar e-mail via Resend: ${sendError.message}`;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Falha inesperada ao notificar desconexão: ${message}`;
  }
}
```

**Step 3: Rodar `npx tsc --noEmit` e `npm run lint`**

**Step 4: Commit**

```bash
git add lib/email/templates.ts lib/email/notifyAccountDisconnected.ts
git commit -m "feat(m9): adiciona template e funcao de alerta de conta desconectada"
```

---

### Task 7: Consulta de posts elegíveis para coleta de métricas

**Files:**
- Create: `lib/analytics/metrics.ts`

**Step 1: Escrever `listPostsForMetricsCollection`**

Mesmo padrão de `lib/posts/pendingPublish.ts`: cliente service-role, log de erro sem lançar.

```ts
import { createServiceClient } from "@/lib/supabase/service";
import { METRICS_COLLECTION_WINDOW_DAYS } from "./constants";

export interface PostForMetricsCollection {
  id: string;
  post_url: string;
}

export async function listPostsForMetricsCollection(): Promise<
  PostForMetricsCollection[]
> {
  const supabase = createServiceClient();
  const cutoff = new Date(
    Date.now() - METRICS_COLLECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select("id, post_url, published_at")
    .eq("status", "publicado")
    .not("post_url", "is", null)
    .gte("published_at", cutoff);

  if (error) {
    console.error(
      "[collect-metrics] falha ao buscar posts publicados:",
      error.message
    );
    return [];
  }

  return (data ?? []).map((post) => ({
    id: post.id,
    post_url: post.post_url as string,
  }));
}

export async function upsertPostMetrics(
  postId: string,
  metrics: { likes: number | null; comments: number | null; reach: number | null }
) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("post_metrics").upsert({
    post_id: postId,
    likes: metrics.likes,
    comments: metrics.comments,
    reach: metrics.reach,
    collected_at: new Date().toISOString(),
    metrics_error: null,
  });

  if (error) {
    console.error(
      `[collect-metrics] falha ao gravar metricas do post ${postId}:`,
      error.message
    );
  }
}

export async function recordMetricsError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("post_metrics")
    .upsert(
      { post_id: postId, metrics_error: message, collected_at: new Date().toISOString() },
      { onConflict: "post_id", ignoreDuplicates: false }
    );

  if (error) {
    console.error(
      `[collect-metrics] falha ao gravar metrics_error do post ${postId}:`,
      error.message
    );
  }
}
```

**Step 2: Rodar `npx tsc --noEmit`**

**Step 3: Commit**

```bash
git add lib/analytics/metrics.ts
git commit -m "feat(m9): adiciona consultas de coleta de metricas"
```

---

### Task 8: Cron `collect-metrics`

**Files:**
- Create: `app/api/cron/collect-metrics/route.ts`
- Modify: `vercel.json`

**Step 1: Escrever a rota do cron**

Mesmo padrão de autenticação `CRON_SECRET` fail-closed dos crons existentes (`app/api/cron/sla-alert/route.ts`). Nota: `upsertPostMetrics` grava `likes/comments/reach` como `null` quando a métrica individual não vier no payload do Zernio — isso é esperado do stub best-effort, não é tratado como erro; só falha de rede/HTTP/resposta ausente vira `metrics_error` (ver Task 7 e Task 3).

```ts
import { NextResponse } from "next/server";

import { getPublishingProvider, PublishError } from "@/lib/publishing";
import {
  listPostsForMetricsCollection,
  recordMetricsError,
  upsertPostMetrics,
} from "@/lib/analytics/metrics";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const posts = await listPostsForMetricsCollection();
  const provider = getPublishingProvider();
  let collected = 0;

  for (const post of posts) {
    try {
      const metrics = await provider.getMetrics(post.post_url);
      await upsertPostMetrics(post.id, metrics);
      collected += 1;
    } catch (err) {
      const message =
        err instanceof PublishError
          ? err.message
          : "Erro inesperado ao coletar métricas via Zernio.";
      await recordMetricsError(post.id, message);
    }
  }

  return NextResponse.json({ collected, total: posts.length });
}
```

**Step 2: Registrar o cron em `vercel.json`**

```diff
     {
       "path": "/api/cron/acervo-schedule",
       "schedule": "*/30 * * * *"
+    },
+    {
+      "path": "/api/cron/collect-metrics",
+      "schedule": "*/30 * * * *"
     }
```

**Step 3: Rodar `npx tsc --noEmit`, `npm run lint` e `npm run build`**

**Step 4: Commit**

```bash
git add "app/api/cron/collect-metrics/route.ts" vercel.json
git commit -m "feat(m9): adiciona cron de coleta de metricas"
```

---

### Task 9: Rastreio de falhas consecutivas e alerta de desconexão em `publish-scheduled`

**Files:**
- Modify: `lib/posts/pendingPublish.ts`
- Modify: `app/api/cron/publish-scheduled/route.ts`

**Step 1: Incluir `social_account_id` e status de conexão na consulta**

`lib/posts/pendingPublish.ts` já traz `social_account: { zernio_account_id }` via join. Adicionar `id` e os 3 campos novos ao select (linha 20) e ao tipo `PostPendingPublish`:

```diff
 export interface PostPendingPublish {
   id: string;
   caption: string;
   rendered_art_url: string;
-  social_account: { zernio_account_id: string | null } | null;
+  social_account_id: string | null;
+  social_account: {
+    zernio_account_id: string | null;
+    display_name: string;
+    consecutive_publish_failures: number;
+  } | null;
 }
```

```diff
     .select(
-      "id, caption, rendered_art_url, content_source, scheduled_at, social_account:social_accounts(zernio_account_id)"
+      "id, caption, rendered_art_url, content_source, scheduled_at, social_account_id, social_account:social_accounts(zernio_account_id, display_name, consecutive_publish_failures)"
     )
```

E no `.map(...)` final do arquivo (linha 60), incluir `social_account_id`:

```diff
-  return eligible.map(({ id, caption, rendered_art_url, social_account }) => ({
+  return eligible.map(({ id, caption, rendered_art_url, social_account_id, social_account }) => ({
     id,
     caption,
     rendered_art_url,
+    social_account_id,
     social_account,
   }));
```

**Step 2: Adicionar helpers de contador em `publish-scheduled/route.ts`**

Logo abaixo de `recordPublishSucceededButStatusFailed`:

```ts
import { DISCONNECT_FAILURE_THRESHOLD } from "@/lib/analytics/constants";
import { notifyAccountDisconnected } from "@/lib/email/notifyAccountDisconnected";

async function recordPublishSuccessOnAccount(socialAccountId: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("social_accounts")
    .update({
      consecutive_publish_failures: 0,
      connection_status: "conectada",
      disconnected_alert_sent_at: null,
    })
    .eq("id", socialAccountId);

  if (error) {
    console.error(
      `[publish-scheduled] falha ao resetar contador de falhas da conta ${socialAccountId}:`,
      error.message
    );
  }
}

async function recordPublishFailureOnAccount(
  socialAccountId: string,
  currentFailures: number,
  currentConnectionStatus: string,
  accountLabel: string
) {
  const supabase = createServiceClient();
  const nextFailures = currentFailures + 1;
  const shouldDisconnect =
    nextFailures >= DISCONNECT_FAILURE_THRESHOLD &&
    currentConnectionStatus === "conectada";

  const { error } = await supabase
    .from("social_accounts")
    .update({
      consecutive_publish_failures: nextFailures,
      ...(shouldDisconnect ? { connection_status: "desconectada" } : {}),
    })
    .eq("id", socialAccountId);

  if (error) {
    console.error(
      `[publish-scheduled] falha ao incrementar contador de falhas da conta ${socialAccountId}:`,
      error.message
    );
    return;
  }

  if (shouldDisconnect) {
    const alertError = await notifyAccountDisconnected(accountLabel);
    const { error: alertWriteError } = await supabase
      .from("social_accounts")
      .update({
        disconnected_alert_sent_at: alertError ? null : new Date().toISOString(),
      })
      .eq("id", socialAccountId);

    if (alertError) {
      console.error(
        `[publish-scheduled] falha ao enviar alerta de desconexao da conta ${socialAccountId}:`,
        alertError
      );
    }
    if (alertWriteError) {
      console.error(
        `[publish-scheduled] falha ao gravar disconnected_alert_sent_at da conta ${socialAccountId}:`,
        alertWriteError.message
      );
    }
  }
}
```

**Step 3: Chamar os helpers no loop principal**

No bloco `try`/`catch` do `for (const post of pending)` (linhas 98-131), depois de `published += 1;` no caminho de sucesso:

```diff
       published += 1;
+      if (post.social_account_id) {
+        await recordPublishSuccessOnAccount(post.social_account_id);
+      }
     } catch (err) {
       const message =
         err instanceof PublishError
           ? err.message
           : "Erro inesperado ao publicar via Zernio.";
       await recordPublishError(post.id, message);
+      if (post.social_account_id && post.social_account) {
+        await recordPublishFailureOnAccount(
+          post.social_account_id,
+          post.social_account.consecutive_publish_failures,
+          "conectada", // ver nota abaixo
+          post.social_account.display_name
+        );
+      }
     }
```

Nota: o terceiro argumento (`currentConnectionStatus`) precisa vir do banco, não de uma string fixa — adicionar `connection_status` ao select da Task 9.1 junto dos outros campos de `social_account` e usar `post.social_account.connection_status` no lugar do literal `"conectada"` acima. Atualizar também a interface `PostPendingPublish` para incluir `connection_status: string` no objeto `social_account`.

Também tratar o caminho de "conta sem `zernio_account_id`" (linhas 62-69, antes do `try`): esse é um erro de configuração, não um sinal de desconexão real — não deve incrementar o contador. Manter como está, sem chamar `recordPublishFailureOnAccount` ali.

**Step 4: Rodar `npx tsc --noEmit` e `npm run lint`**

**Step 5: Commit**

```bash
git add lib/posts/pendingPublish.ts "app/api/cron/publish-scheduled/route.ts"
git commit -m "feat(m9): rastreia falhas consecutivas e dispara alerta de desconexao"
```

---

### Task 10: Consulta de agregação para o dashboard

**Files:**
- Create: `lib/analytics/queries.ts`

**Step 1: Escrever `listAnalyticsSummary`**

Busca `post_metrics` já coletadas (últimos 30 dias, mesma janela da Task 4) e agrega por conta, artista e hora — em memória, um único round-trip ao Supabase, mesmo espírito de `lib/acervo/queries.ts` (M8).

```ts
import { createClient } from "@/lib/supabase/server";
import { METRICS_COLLECTION_WINDOW_DAYS } from "./constants";

interface AggregatedRow {
  key: string;
  label: string;
  posts: number;
  likes: number;
  comments: number;
  reach: number;
}

export interface AnalyticsSummary {
  byAccount: AggregatedRow[];
  byArtist: AggregatedRow[];
  byHour: AggregatedRow[];
}

function accumulate(map: Map<string, AggregatedRow>, key: string, label: string, metrics: {
  likes: number | null;
  comments: number | null;
  reach: number | null;
}) {
  const existing = map.get(key) ?? { key, label, posts: 0, likes: 0, comments: 0, reach: 0 };
  existing.posts += 1;
  existing.likes += metrics.likes ?? 0;
  existing.comments += metrics.comments ?? 0;
  existing.reach += metrics.reach ?? 0;
  map.set(key, existing);
}

export async function listAnalyticsSummary(): Promise<AnalyticsSummary> {
  const supabase = await createClient();
  const cutoff = new Date(
    Date.now() - METRICS_COLLECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("post_metrics")
    .select(
      "likes, comments, reach, post:posts(scheduled_at, published_at, social_account:social_accounts(display_name), artist:artists(name))"
    )
    .gte("collected_at", cutoff)
    .not("collected_at", "is", null);

  if (error) {
    console.error("[analytics] falha ao buscar resumo de métricas:", error.message);
    return { byAccount: [], byArtist: [], byHour: [] };
  }

  const byAccount = new Map<string, AggregatedRow>();
  const byArtist = new Map<string, AggregatedRow>();
  const byHour = new Map<string, AggregatedRow>();

  for (const row of (data ?? []) as unknown as {
    likes: number | null;
    comments: number | null;
    reach: number | null;
    post: {
      scheduled_at: string | null;
      published_at: string | null;
      social_account: { display_name: string } | null;
      artist: { name: string } | null;
    } | null;
  }[]) {
    if (!row.post) continue;
    const metrics = { likes: row.likes, comments: row.comments, reach: row.reach };

    if (row.post.social_account) {
      accumulate(
        byAccount,
        row.post.social_account.display_name,
        row.post.social_account.display_name,
        metrics
      );
    }

    if (row.post.artist) {
      accumulate(byArtist, row.post.artist.name, row.post.artist.name, metrics);
    }

    const timestamp = row.post.scheduled_at ?? row.post.published_at;
    if (timestamp) {
      const hour = new Date(timestamp).getHours();
      const key = String(hour).padStart(2, "0");
      accumulate(byHour, key, `${key}h`, metrics);
    }
  }

  const sortByPosts = (a: AggregatedRow, b: AggregatedRow) => b.posts - a.posts;

  return {
    byAccount: Array.from(byAccount.values()).sort(sortByPosts),
    byArtist: Array.from(byArtist.values()).sort(sortByPosts),
    byHour: Array.from(byHour.values()).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
```

**Step 2: Rodar `npx tsc --noEmit`**

**Step 3: Commit**

```bash
git add lib/analytics/queries.ts
git commit -m "feat(m9): adiciona consulta de resumo de analytics"
```

---

### Task 11: Seção de analytics no dashboard

**Files:**
- Create: `components/dashboard/analytics-summary.tsx`
- Modify: `app/(dashboard)/dashboard/page.tsx`

**Step 1: Escrever o componente**

Três blocos lado a lado (conta/artista/horário), mesmo padrão visual de cards de `page.tsx` (`rounded-xl border border-border bg-card`). Sem gráfico (fora de escopo — YAGNI; `docs/CLAUDE.md` já orienta o dashboard a "deixar claro o que é conteúdo de volume vs. estratégico", que a contagem de posts por linha já cobre).

```tsx
import type { AnalyticsSummary } from "@/lib/analytics/queries";

function SummaryTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: AnalyticsSummary["byAccount"];
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">Nome</th>
              <th className="py-1">Posts</th>
              <th className="py-1">Curtidas</th>
              <th className="py-1">Comentários</th>
              <th className="py-1">Alcance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border/50 text-foreground">
                <td className="py-1">{row.label}</td>
                <td className="py-1">{row.posts}</td>
                <td className="py-1">{row.likes}</td>
                <td className="py-1">{row.comments}</td>
                <td className="py-1">{row.reach}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AnalyticsSummarySection({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">
        Analytics (últimos 30 dias)
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SummaryTable
          title="Por conta"
          rows={summary.byAccount}
          emptyLabel="Sem métricas coletadas ainda."
        />
        <SummaryTable
          title="Por artista"
          rows={summary.byArtist}
          emptyLabel="Sem posts com artista vinculado."
        />
        <SummaryTable
          title="Por horário"
          rows={summary.byHour}
          emptyLabel="Sem métricas coletadas ainda."
        />
      </div>
    </div>
  );
}
```

**Step 2: Badge de conexão + wire da seção em `page.tsx`**

Importar `listAnalyticsSummary` e `AnalyticsSummarySection`, buscar em paralelo com o resto, e renderizar a seção. Também adicionar um badge de `connection_status` no card de "Contas sociais conectadas" existente (linhas 61-70) quando alguma estiver desconectada:

```diff
-import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";
+import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";
+import { listAnalyticsSummary } from "@/lib/analytics/queries";
+import { AnalyticsSummarySection } from "@/components/dashboard/analytics-summary";
```

```diff
   const profile = await getCurrentProfile();
-  const [posts, artists, socialAccounts] = await Promise.all([
+  const [posts, artists, socialAccounts, analyticsSummary] = await Promise.all([
     listPosts(),
     listArtists(),
     listSocialAccounts(),
+    listAnalyticsSummary(),
   ]);
+
+  const disconnectedAccounts = socialAccounts.filter(
+    (account) => account.connection_status === "desconectada"
+  );
```

Depois do card de "Contas sociais conectadas" (linha 70), antes de fechar a `div` de grid (linha 71):

```tsx
      {disconnectedAccounts.length > 0 && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {disconnectedAccounts.length === 1
            ? `A conta ${disconnectedAccounts[0].display_name} parece estar desconectada — verifique em /admin/contas.`
            : `${disconnectedAccounts.length} contas parecem estar desconectadas — verifique em /admin/contas.`}
        </div>
      )}

      <AnalyticsSummarySection summary={analyticsSummary} />
```

**Step 3: Rodar `npx tsc --noEmit`, `npm run lint` e `npm run build`**

**Step 4: Commit**

```bash
git add components/dashboard/analytics-summary.tsx "app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(m9): adiciona secao de analytics e aviso de desconexao no dashboard"
```

---

### Task 12: Atualizar `PLAN.md`

**Files:**
- Modify: `PLAN.md`

**Step 1: Marcar M9 como "código pronto, checklist manual pendente"**

Seguindo exatamente o padrão de redação usado em M3–M8 (`PLAN.md`): objetivo, itens `[x]` implementados, nota de "pronto para avançar quando" com o checklist manual restante — aplicar a migration `0010_analytics.sql`; rodar o cron `collect-metrics` manualmente contra um post publicado real e conferir `post_metrics` preenchido; forçar 3 falhas consecutivas de publicação numa conta de teste (ex.: `zernio_account_id` inválido) e conferir `connection_status='desconectada'` + e-mail de alerta enviado uma única vez; publicar com sucesso na mesma conta depois e conferir que `connection_status` volta a `'conectada'`; conferir a seção de analytics em `/dashboard` com dados reais agregados por conta/artista/horário; derrubar `RESEND_API_KEY` e confirmar que o cron de publicação continua funcionando normalmente com o alerta silenciosamente registrado em log (mesmo padrão de `notification_error` dos milestones anteriores) — mesma limitação de todos os milestones anteriores, nenhum tem o checklist manual rodado neste sandbox.

**Step 2: Commit**

```bash
git add PLAN.md
git commit -m "docs: marca M9 como codigo pronto, checklist manual pendente"
```

---

### Task 13: Verificação final da branch

**Step 1: Rodar a suíte completa**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Todos devem rodar limpos (mesmos warnings pré-existentes de `<img>`/`alt` nos templates Satori já documentados nos milestones anteriores são aceitáveis; nenhum warning novo).

**Step 2: Revisão da branch inteira**

Usar o agent `code-reviewer` para revisar o diff completo da branch antes do merge — mesmo padrão de "revisão final da branch" usado em M2, M5, M6, M7, M8. Prestar atenção especial a: (a) o encadeamento de updates em `recordPublishFailureOnAccount` (contador → status → alerta → timestamp) não é atômico — uma falha entre passos pode deixar `connection_status='desconectada'` sem `disconnected_alert_sent_at` gravado, o que é aceitável (só atrasa/não duplica o alerta, nunca envia sem gravar por muito tempo) mas vale confirmar que a leitura concorrente por outra execução do cron não causa envio duplicado do e-mail; (b) `listAnalyticsSummary` decodifica o retorno do Supabase com `as unknown as` — confirmar que o formato do join (`post:posts(...)`) realmente retorna objeto único e não array antes de confiar no cast.

**Step 3: Merge e push**

Seguir `docs/CLAUDE.md`: push para `origin/main` faz parte do fluxo normal depois do merge, sem pedir confirmação adicional (só operações destrutivas exigem confirmação).
