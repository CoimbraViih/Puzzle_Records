# M6 — Fila de Aprovação Completa — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fechar o ciclo ponta a ponta de aprovação — todo post criado por Drive+IA (M3/M4/M5) consegue ser revisado, ter preview fiel (Instagram primeiro), ser aprovado/editado/rejeitado, e o aprovador é notificado por e-mail (Resend) tanto no envio para aprovação quanto no alerta de SLA de 4h sem decisão.

**Architecture:** Fecha o gap de RLS/UI que hoje impede mover um post de `pendente` (Drive/IA) para `pendente_aprovacao`; adiciona duas colunas de rastreio de SLA (`submitted_for_approval_at`, `sla_alert_sent_at`) e uma coluna `notification_error` (mesmo padrão de `art_generation_error`/`copy_generation_error` — falha de e-mail nunca é silenciosa); um módulo `lib/email/` fino sobre o SDK do Resend; um novo cron `sla-alert` seguindo exatamente o padrão de autenticação/erro dos crons existentes (`generate-art`); e um componente de preview estilo Instagram reaproveitado no Kanban existente. Nenhuma tabela nova de fila é criada — o Kanban de `/aprovacao` já existe desde o M2, este milestone só fecha as lacunas que impediam o fluxo real de funcionar ponta a ponta.

**Tech Stack:** Next.js server actions, Supabase Postgres + RLS, `resend` (novo pacote), Vercel Cron, componentes existentes em `components/kanban/`.

**Nota sobre verificação:** este projeto não tem suite de testes automatizados (Jest/Vitest) configurada — todos os milestones anteriores (ver `PLAN.md`) verificam via `npm run lint`, `npx tsc --noEmit`, `npm run build`, e um checklist manual contra um projeto Supabase linkado (o sandbox de desenvolvimento não tem um linkado). Este plano segue a mesma convenção em vez de forçar TDD com um framework que não existe no repo — cada task termina em "rodar lint/tsc" em vez de "rodar o teste". O checklist manual fica registrado na Task 9.

---

### Task 1: Migration `0006_approval_queue.sql` — colunas de SLA/notificação + fecha o gap `pendente → pendente_aprovacao`

**Contexto do bug que está sendo fechado:** a policy `posts_update_owner_draft_or_rejected` (`supabase/migrations/0002_content_model.sql:121-132`) só libera UPDATE para `equipe_conteudo` quando `status in ('rascunho', 'rejeitado')` e `created_by = auth.uid()`. Posts vindos do Drive (M3) nascem com `status='pendente'` e frequentemente `created_by is null` (ninguém da equipe os criou manualmente) — hoje **nenhum papel consegue submeter esses posts para aprovação**, exatamente a lacuna documentada no `PLAN.md` no M4. A UI (`canSubmit`/`canEdit` em `components/kanban/post-card.tsx:20-47`) também nunca inclui `'pendente'` na lista de status elegíveis, então mesmo corrigindo só o banco nada muda até a Task 4.

**Files:**
- Create: `supabase/migrations/0006_approval_queue.sql`

**Step 1: Escrever a migration**

```sql
-- M6: fecha o gap que impedia mover um post 'pendente' (Drive/IA, M3/M4/M5)
-- para 'pendente_aprovacao' — nem RLS nem UI cobriam essa transição desde
-- o M4 (ver nota em PLAN.md). Também adiciona rastreio de SLA (4h sem
-- decisão) e o mesmo padrão de coluna "*_error" usado por
-- copy_generation_error/art_generation_error para a notificação por e-mail
-- nunca falhar em silêncio.

alter table public.posts
  add column submitted_for_approval_at timestamptz,
  add column sla_alert_sent_at timestamptz,
  add column notification_error text;

-- Substitui a policy do M2: adiciona 'pendente' ao USING (permite editar/
-- submeter posts recém-ingeridos do Drive) e trata created_by nulo (posts
-- do Drive não têm autor humano) tratando qualquer equipe_conteudo como
-- dona de um post 'pendente' sem criador. WITH CHECK ganha 'pendente' na
-- lista porque ações que só editam texto/variação de copy/arte sem mudar
-- o status (ex: selectCopyVariation, regenerateArt) mantêm o post em
-- 'pendente' até o clique explícito em "Enviar para aprovação".
drop policy "posts_update_owner_draft_or_rejected" on public.posts;

create policy "posts_update_owner_draft_or_rejected"
  on public.posts for update
  using (
    public.has_role('equipe_conteudo')
    and (created_by = auth.uid() or (created_by is null and status = 'pendente'))
    and status in ('pendente', 'rascunho', 'rejeitado')
  )
  with check (
    public.has_role('equipe_conteudo')
    and (created_by = auth.uid() or (created_by is null and status in ('pendente', 'pendente_aprovacao')))
    and status in ('pendente', 'rascunho', 'pendente_aprovacao', 'rejeitado')
  );
```

**Step 2: Aplicar a migration localmente (se houver um projeto Supabase linkado) e conferir**

Run: `npx supabase db push` (ou `npx supabase migration up` conforme o fluxo já usado nos milestones anteriores — ver `docs/DEPLOY.md`)
Expected: migration aplica sem erro; `select column_name from information_schema.columns where table_name='posts'` mostra as 3 colunas novas.

Sem projeto linkado no sandbox atual, valide só a sintaxe:
Run: `npx supabase db lint` (se disponível) ou revisão manual do SQL acima.

**Step 3: Commit**

```bash
git add supabase/migrations/0006_approval_queue.sql
git commit -m "feat(m6): fecha RLS de pendente->pendente_aprovacao e adiciona colunas de SLA/notificação"
```

---

### Task 2: Tipos — `lib/types/post.ts`

**Files:**
- Modify: `lib/types/post.ts`

**Step 1:** Adicionar os 3 campos novos ao tipo `Post`/`PostWithRelations` (mesmo padrão dos campos opcionais já existentes como `art_generation_error`):

```ts
submitted_for_approval_at: string | null;
sla_alert_sent_at: string | null;
notification_error: string | null;
```

**Step 2:** Confirmar que `lib/posts/queries.ts` usa `select("*, artist:artists(...), social_account:social_accounts(...)")` (select `*` já traz as colunas novas automaticamente — sem mudança de query necessária, só o tipo TS precisa refletir as colunas).

**Step 3: Rodar checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos (os únicos usos de `PostWithRelations` até aqui são leitura, não deve quebrar nada).

**Step 4: Commit**

```bash
git add lib/types/post.ts
git commit -m "feat(m6): adiciona campos de SLA/notificação ao tipo Post"
```

---

### Task 3: Permissões — incluir `'pendente'` em `canEdit`/`canSubmit` (`components/kanban/post-card.tsx`)

**Files:**
- Modify: `components/kanban/post-card.tsx:20-47`

**Step 1:** Espelhar exatamente a policy da Task 1 nas funções puras de permissão:

```ts
function canEdit(post: PostWithRelations, role: Role, userId: string) {
  if (role === "admin") return true;
  if (role === "equipe_conteudo") {
    const owned = post.created_by === userId || post.created_by === null;
    return (
      owned &&
      (post.status === "pendente" ||
        post.status === "rascunho" ||
        post.status === "rejeitado")
    );
  }
  if (role === "aprovador") return post.status === "pendente_aprovacao";
  return false;
}

function canSubmit(post: PostWithRelations, role: Role, userId: string) {
  const ownedByAuthor =
    role === "equipe_conteudo" &&
    (post.created_by === userId || post.created_by === null);
  const eligibleStatus =
    post.status === "pendente" ||
    post.status === "rascunho" ||
    post.status === "rejeitado";
  return (ownedByAuthor || role === "admin") && eligibleStatus;
}
```

`canDelete` **não muda** — continua só permitindo excluir `rascunho` próprio (não faz sentido excluir um post que o Drive já ingeriu; se for indesejado, o fluxo correto é rejeitar depois de submeter, não apagar um "pendente").

**Step 2:** No botão de submeter (`post-card.tsx:179-187`), o label "Enviar para aprovação" / "Reenviar" já cobre o caso `pendente` sem mudança (só `rejeitado` usa "Reenviar").

**Step 3: Rodar lint e build**

Run: `npm run lint && npx tsc --noEmit`
Expected: limpo.

**Step 4: Commit**

```bash
git add components/kanban/post-card.tsx
git commit -m "feat(m6): permite editar/submeter posts pendente (Drive/IA) para aprovação"
```

---

### Task 4: Ações — rastrear SLA em `submitForApproval`/`approvePost`/`rejectPost` (`lib/posts/actions.ts`)

**Files:**
- Modify: `lib/posts/actions.ts:205-250`
- Create: `lib/email/client.ts`, `lib/email/templates.ts`, `lib/email/notifyApprovers.ts` (feitos na Task 5, mas `submitForApproval` já importa daqui — implemente a Task 5 antes de testar esta end-to-end, ou faça as duas tasks em sequência sem commit intermediário quebrado)

**Step 1:** Atualizar `submitForApproval` para carimbar o início do SLA e zerar o alerta anterior (relevante em reenvio pós-rejeição, para o timer de 4h recomeçar), e disparar a notificação:

```ts
export async function submitForApproval(postId: string, _formData: FormData) {
  const error = await updateStatus(postId, "pendente_aprovacao", {
    submitted_for_approval_at: new Date().toISOString(),
    sla_alert_sent_at: null,
  });
  if (error) return;

  revalidatePostPages();

  const { data: post } = await (await createClient())
    .from("posts")
    .select("id, headline")
    .eq("id", postId)
    .single();

  const notificationError = await notifyApprovers({
    kind: "novo_post",
    postId,
    headline: post?.headline ?? null,
  });
  if (notificationError) {
    await updateStatus(postId, "pendente_aprovacao", {
      notification_error: notificationError,
    });
  }
}
```

Note: `updateStatus` já existe e faz `update({status, ...extra}).eq("id", postId).select("id")` — reaproveitado sem mudança de assinatura, só passando mais campos em `extra`.

**Step 2:** Atualizar `approvePost` e `rejectPost` para limpar o rastreio de SLA (a decisão foi tomada, não faz sentido a linha continuar "aberta" para o cron considerar):

```ts
export async function approvePost(postId: string, _formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const error = await updateStatus(postId, "aprovado", {
    approved_by: profile.id,
    rejection_reason: null,
    submitted_for_approval_at: null,
    sla_alert_sent_at: null,
  });
  if (!error) revalidatePostPages();
}
```

E em `rejectPost`, adicionar `submitted_for_approval_at: null, sla_alert_sent_at: null` ao objeto passado em `.update({...})` (linha 240).

**Step 3:** Adicionar o import no topo do arquivo:

```ts
import { notifyApprovers } from "@/lib/email/notifyApprovers";
```

**Step 4: Rodar lint/tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: vai falhar até a Task 5 existir (`notifyApprovers` não existe ainda) — normal, siga para a Task 5 antes de rodar esta verificação isoladamente.

**Step 5: Commit** (só depois da Task 5 estar pronta, para não commitar código que não compila)

```bash
git add lib/posts/actions.ts
git commit -m "feat(m6): rastreia inicio/fim do SLA de aprovacao e dispara notificacao no envio"
```

---

### Task 5: Módulo de e-mail — `lib/email/`

**Files:**
- Create: `lib/email/client.ts`
- Create: `lib/email/templates.ts`
- Create: `lib/email/notifyApprovers.ts`
- Modify: `.env.example`
- Modify: `package.json` (via `npm install`)

**Step 1: Instalar o SDK**

Run: `npm install resend`
Expected: adiciona `resend` em `package.json`/`package-lock.json`.

**Step 2: Cliente fino do Resend**

```ts
// lib/email/client.ts
import { Resend } from "resend";

let cached: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cached) cached = new Resend(apiKey);
  return cached;
}

export const EMAIL_FROM =
  process.env.RESEND_FROM_EMAIL ?? "Puzzle Records <onboarding@resend.dev>";
```

Retornar `null` (em vez de lançar) quando a env var não estiver configurada segue o mesmo espírito de "nunca falhar em silêncio, mas nunca derrubar o fluxo principal por causa de uma integração secundária" — quem chama decide o que fazer (aqui, grava em `notification_error`).

**Step 3: Templates simples**

```ts
// lib/email/templates.ts
export function newPostSubject(headline: string | null) {
  return `Novo post aguardando aprovação${headline ? `: ${headline}` : ""}`;
}

export function newPostBody(postId: string, headline: string | null) {
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/aprovacao`;
  return `<p>Um post está aguardando sua aprovação${
    headline ? `: <strong>${headline}</strong>` : ""
  }.</p><p><a href="${url}">Abrir a fila de aprovação</a></p>`;
}

export function slaAlertSubject(headline: string | null) {
  return `⏰ SLA de aprovação vencido${headline ? `: ${headline}` : ""}`;
}

export function slaAlertBody(postId: string, headline: string | null) {
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/aprovacao`;
  return `<p>Um post está pendente de aprovação há mais de 4 horas${
    headline ? `: <strong>${headline}</strong>` : ""
  }.</p><p><a href="${url}">Abrir a fila de aprovação</a></p>`;
}
```

**Step 4: `notifyApprovers` — busca destinatários via service role e envia**

Usa `createServiceClient()` (não `createClient()`) porque a policy `profiles_select_own_or_admin` (`supabase/migrations/0001_profiles.sql:28-30`) bloqueia um usuário `equipe_conteudo` de listar e-mails de outros perfis — a notificação é uma operação de sistema, não uma leitura em nome do usuário logado.

```ts
// lib/email/notifyApprovers.ts
import { createServiceClient } from "@/lib/supabase/service";
import { getResendClient, EMAIL_FROM } from "./client";
import {
  newPostSubject,
  newPostBody,
  slaAlertSubject,
  slaAlertBody,
} from "./templates";

type NotifyParams = {
  kind: "novo_post" | "sla_vencido";
  postId: string;
  headline: string | null;
};

/** Retorna uma mensagem de erro (para gravar em notification_error) ou null em caso de sucesso. */
export async function notifyApprovers({
  kind,
  postId,
  headline,
}: NotifyParams): Promise<string | null> {
  const resend = getResendClient();
  if (!resend) {
    return "RESEND_API_KEY não configurada — notificação não enviada.";
  }

  const supabase = createServiceClient();
  const { data: recipients, error } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["aprovador", "admin"]);

  if (error) {
    return `Falha ao buscar destinatários da notificação: ${error.message}`;
  }
  if (!recipients || recipients.length === 0) {
    return "Nenhum aprovador/admin cadastrado para notificar.";
  }

  const subject =
    kind === "novo_post" ? newPostSubject(headline) : slaAlertSubject(headline);
  const html =
    kind === "novo_post"
      ? newPostBody(postId, headline)
      : slaAlertBody(postId, headline);

  const { error: sendError } = await resend.emails.send({
    from: EMAIL_FROM,
    to: recipients.map((r) => r.email),
    subject,
    html,
  });

  if (sendError) {
    return `Falha ao enviar e-mail via Resend: ${sendError.message}`;
  }
  return null;
}
```

**Step 5: Documentar a env var nova**

Adicionar em `.env.example` (perto de `RESEND_API_KEY=`):

```
RESEND_FROM_EMAIL=
```

**Step 6: Rodar lint/tsc/build (agora com a Task 4 já integrada)**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: limpo.

**Step 7: Commit**

```bash
git add lib/email package.json package-lock.json .env.example lib/posts/actions.ts
git commit -m "feat(m6): notifica aprovador/admin por e-mail (Resend) ao enviar post para aprovacao"
```

---

### Task 6: Cron de alerta de SLA — `app/api/cron/sla-alert/route.ts`

Segue exatamente o padrão de `app/api/cron/generate-art/route.ts:6-10` (auth via `CRON_SECRET`, falha fechada se a env var não estiver setada, service client, nunca lança sem gravar o motivo).

**Files:**
- Create: `app/api/cron/sla-alert/route.ts`
- Modify: `vercel.json`

**Step 1: Escrever a rota**

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyApprovers } from "@/lib/email/notifyApprovers";

const SLA_HOURS = 4;

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
  const cutoff = new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000).toISOString();

  const { data: overdue, error } = await supabase
    .from("posts")
    .select("id, headline")
    .eq("status", "pendente_aprovacao")
    .lt("submitted_for_approval_at", cutoff)
    .is("sla_alert_sent_at", null);

  if (error) {
    console.error("[sla-alert] falha ao buscar posts vencidos:", error.message);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let alerted = 0;
  for (const post of overdue ?? []) {
    const notificationError = await notifyApprovers({
      kind: "sla_vencido",
      postId: post.id,
      headline: post.headline,
    });

    const { error: updateError } = await supabase
      .from("posts")
      .update({
        sla_alert_sent_at: notificationError ? null : new Date().toISOString(),
        notification_error: notificationError,
      })
      .eq("id", post.id);

    if (updateError) {
      console.error(`[sla-alert] falha ao gravar alerta do post ${post.id}:`, updateError.message);
      continue;
    }
    if (!notificationError) alerted += 1;
  }

  return NextResponse.json({ alerted, total: (overdue ?? []).length });
}
```

Nota: se `notifyApprovers` falhar, `sla_alert_sent_at` fica `null` de propósito — assim a próxima execução do cron tenta de novo em vez de desistir silenciosamente (mesmo espírito do `art_generation_error`, que também não trava o post permanentemente).

**Step 2: Registrar o cron no `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/drive-ingest", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/generate-copy", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/generate-art", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/sla-alert", "schedule": "*/30 * * * *" }
  ]
}
```

**Recomendação sobre o intervalo:** `*/30 * * * *` (a cada 30 min) — o alerta é sobre um SLA de 4h, então checar a cada 5 min como os outros crons seria desperdício de invocação sem ganho real de precisão; 30 min garante o alerta sair no máximo 30 min depois de vencer o prazo, o que é imperceptível numa janela de 4h.

**Step 3: Rodar lint/tsc/build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: limpo.

**Step 4: Commit**

```bash
git add app/api/cron/sla-alert/route.ts vercel.json
git commit -m "feat(m6): cron de alerta de SLA (4h sem aprovacao)"
```

---

### Task 7: Preview fiel por rede (Instagram primeiro) — `components/kanban/instagram-preview.tsx`

**Files:**
- Create: `components/kanban/instagram-preview.tsx`
- Modify: `components/kanban/post-card.tsx` (botão "Ver preview" abrindo um `Dialog`)

**Step 1:** Criar o componente de preview. Reaproveita `rendered_art_signed_url` (a arte final gerada no M5) como a imagem do post — é o que de fato vai ao ar, não a mídia bruta:

```tsx
// components/kanban/instagram-preview.tsx
import type { PostWithRelations } from "@/lib/types/post";

const IG_PLACEHOLDER_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%2396DB12'/%3E%3C/svg%3E";

export function InstagramPreview({ post }: { post: PostWithRelations }) {
  const isInstagram = post.social_account?.network === "instagram";
  const imageUrl = post.rendered_art_signed_url ?? post.media_signed_url ?? null;

  if (!isInstagram) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        Preview fiel para{" "}
        {post.social_account?.network ?? "essa rede"} ainda não implementado
        (M6 cobre só Instagram — ver `docs/CLAUDE.md`). Abaixo, a arte e a
        legenda como serão publicadas:
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={post.headline ?? ""} className="mt-2 w-full rounded" />
        )}
        <p className="mt-2 whitespace-pre-wrap">{post.caption}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={IG_PLACEHOLDER_AVATAR} alt="" className="h-8 w-8 rounded-full" />
        <span className="text-sm font-semibold">
          {post.social_account?.handle ?? "puzzlerecordss"}
        </span>
      </div>

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={post.headline ?? ""} className="aspect-square w-full object-cover" />
      )}

      <div className="flex gap-3 p-3 text-lg">
        <span>♡</span>
        <span>💬</span>
        <span>↗</span>
      </div>

      <p className="px-3 pb-3 text-sm">
        <span className="font-semibold">
          {post.social_account?.handle ?? "puzzlerecordss"}
        </span>{" "}
        {post.caption}
      </p>
    </div>
  );
}
```

**Step 2:** Adicionar o botão "Ver preview" em `post-card.tsx`, disponível sempre que houver arte ou mídia (não depende de status — útil desde a edição até a aprovação). Usar o mesmo padrão de `Dialog` já usado em `reject-dialog.tsx`/`post-form-dialog.tsx` (`components/ui/dialog`):

```tsx
import { InstagramPreview } from "./instagram-preview";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";

// dentro do JSX de ações, ao lado dos outros botões:
{(post.rendered_art_signed_url || post.media_signed_url) && (
  <Dialog>
    <DialogTrigger asChild>
      <Button type="button" size="sm" variant="outline">
        Ver preview
      </Button>
    </DialogTrigger>
    <DialogContent>
      <InstagramPreview post={post} />
    </DialogContent>
  </Dialog>
)}
```

(Confirme o export exato de `DialogTrigger`/`DialogContent` em `components/ui/dialog.tsx` antes de colar — são os primitivos shadcn/ui já usados no projeto; ajuste os nomes se divergirem.)

**Step 3: Rodar lint/tsc/build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: limpo.

**Step 4: Commit**

```bash
git add components/kanban/instagram-preview.tsx components/kanban/post-card.tsx
git commit -m "feat(m6): preview fiel do post estilo Instagram no Kanban"
```

---

### Task 8: Exibir `notification_error` no card (mesmo padrão de `art_generation_error`)

**Files:**
- Modify: `components/kanban/post-card.tsx`

**Step 1:** Logo abaixo do bloco de `art_generation_error` (linhas 161-165), adicionar:

```tsx
{post.notification_error && (
  <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
    Notificação por e-mail não enviada: {post.notification_error}
  </p>
)}
```

Cor âmbar (mesma de `ingestion_warning`), não vermelha destrutiva — é um aviso operacional (a aprovação continua funcionando pelo painel mesmo sem e-mail), não um erro que bloqueia o fluxo.

**Step 2: Rodar lint/tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: limpo.

**Step 3: Commit**

```bash
git add components/kanban/post-card.tsx
git commit -m "feat(m6): mostra aviso visivel quando notificacao por e-mail falha"
```

---

### Task 9: Checklist manual + atualizar `PLAN.md`

**Files:**
- Modify: `PLAN.md` (seção M6)
- Create (opcional, mesmo padrão dos milestones anteriores): `docs/plans/2026-07-05-m6-fila-aprovacao-checklist.md` — ou registrar o checklist na própria entrada do `PLAN.md` como nos M1-M5.

**Step 1:** Contra um projeto Supabase linkado de verdade, com `RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`CRON_SECRET`/`NEXT_PUBLIC_APP_URL` configurados:

1. Aplicar a migration `0006_approval_queue.sql`.
2. Confirmar que um post `pendente` (criado via ingestão simulada do Drive, M3) agora mostra os botões "Editar" e "Enviar para aprovação" para `equipe_conteudo`.
3. Clicar "Enviar para aprovação" → status vira `pendente_aprovacao`, `submitted_for_approval_at` é gravado, e-mail chega na caixa de um usuário `aprovador` real.
4. Abrir "Ver preview" num post com conta `instagram` vinculada → conferir o preview fiel; num post com conta `tiktok`/`youtube`/`facebook` → conferir a mensagem de "ainda não implementado".
5. Aprovar e rejeitar um post `pendente_aprovacao` → conferir que `submitted_for_approval_at`/`sla_alert_sent_at` voltam a `null`.
6. Forçar `submitted_for_approval_at` para mais de 4h atrás via SQL direto, chamar `GET /api/cron/sla-alert` com o `CRON_SECRET` correto → conferir e-mail de SLA e `sla_alert_sent_at` preenchido; rodar de novo e confirmar que não reenvia (idempotente).
7. Derrubar a `RESEND_API_KEY` temporariamente e repetir o passo 3 → conferir que o post ainda vai para `pendente_aprovacao` normalmente e o aviso âmbar de `notification_error` aparece no card (nunca falha em silêncio).

**Step 2:** Atualizar a entrada `## M6` do `PLAN.md` para `✅ (código pronto, checklist manual pendente)` seguindo exatamente o texto/formatação usada nos M1-M5, registrando os itens concluídos e o link para este plano.

**Step 3: Commit**

```bash
git add PLAN.md
git commit -m "docs: marca M6 como codigo pronto, checklist manual pendente"
```

---

## Débito técnico conhecido a documentar no `PLAN.md` (baixa prioridade, não bloqueia M7)

- Preview fiel só cobre Instagram (por decisão explícita, "Instagram primeiro" no `docs/CLAUDE.md`) — TikTok/YouTube/Facebook mostram um preview genérico até que M7/M9 tragam a integração real via Zernio.
- O alerta de SLA dispara uma única vez por post (não há lembrete diário se continuar sem decisão depois do primeiro alerta) — suficiente para o MVP, mas fácil de estender depois checando `sla_alert_sent_at < now() - interval '24 hours'` em vez de só `is null`.
- `notifyApprovers` envia para todos os `aprovador`+`admin` de uma vez (sem preferência individual de notificação) — ok para o tamanho de equipe atual da Puzzle Records.
