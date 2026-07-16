# Revisão QA + consolidação de navegação — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidar as três páginas de admin numa só com abas, migrar as funcionalidades únicas de Acervo e Fila de Posts para Drive/Fila de Aprovação, apagar as duas páginas redundantes, construir uma tela de log de testes em tempo real, e rodar uma varredura de QA end-to-end corrigindo bugs encontrados.

**Architecture:** Next.js App Router (Server Components + Server Actions), Supabase (Postgres + RLS + Realtime), `@base-ui/react` para primitivos de UI (não é Radix — ver `AGENTS.md`). Sem framework de testes automatizados no projeto hoje (só ESLint) — a verificação de cada task é `npm run lint`, `npm run build` e checagem manual/Playwright via `npm run dev`, não testes unitários.

**Tech Stack:** Next.js, TypeScript, Supabase (Postgres, Realtime, service-role client), `@base-ui/react/tabs`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-16-revisao-qa-consolidacao-navegacao-design.md`

## Global Constraints

- **Nunca rode `git add -A` ou `git add .`.** Sempre liste os arquivos exatos no `git add`. O working tree tem uma mudança não commitada e intencional em `lib/auth/get-current-profile.ts` (marcada `TEMP DEMO MODE — NÃO COMMITAR` no próprio código) e um diretório `skills/` não rastreado — nenhum dos dois tem relação com este plano e **nenhum commit de nenhuma task pode incluí-los**. Antes de cada commit, rode `git status --short` e confirme que só os arquivos que você mesmo criou/editou para a task aparecem staged.
- Todo commit vai direto pra `main` seguido de `git push origin main` (workflow do projeto, ver `docs/CLAUDE.md`) — não crie branches nem worktrees.

---

## Ordem das fases

1. Tela de log de testes em tempo real (infra usada pela fase 5)
2. Consolidação do admin em abas (independente — pode rodar em paralelo às fases 3/4)
3. Acervo → Drive, depois apagar `/acervo`
4. Fila de Posts → Fila de Aprovação, depois apagar `/conteudo`
5. QA end-to-end de tudo, logando na tela da fase 1, corrigindo bugs achados na hora

Cada fase termina com `npm run lint` e `npm run build` limpos antes do commit final da fase.

---

## Fase 1 — Tela de log de testes em tempo real

### Task 1.1: Migration da tabela `qa_test_runs`

**Files:**
- Create: `supabase/migrations/0022_qa_test_runs.sql`

**Step 1: Escrever a migration**

```sql
-- Tela de log de testes em tempo real (revisão QA de 2026-07-16, ver
-- docs/superpowers/specs/2026-07-16-revisao-qa-consolidacao-navegacao-design.md).
-- Só o script de QA (service-role, roda fora de uma sessão de usuário)
-- escreve aqui -- mesmo padrão de notifications (migration 0013): sem
-- policy de insert para usuários autenticados.
create table public.qa_test_runs (
  id uuid primary key default gen_random_uuid(),
  step text not null,
  target text not null,
  result text not null check (result in ('ok', 'fail', 'info')),
  detail text,
  created_at timestamptz not null default now()
);

alter table public.qa_test_runs enable row level security;

create policy "qa_test_runs_select_authenticated"
  on public.qa_test_runs for select
  using (auth.uid() is not null);
```

**Step 2: Aplicar a migration**

Use a ferramenta MCP do Supabase (`mcp__plugin_supabase_supabase__apply_migration`) com o nome `qa_test_runs` e o SQL acima, contra o projeto de produção (`dtfnxurjemdabqukgqzc` — mesmo projeto de todas as migrations anteriores, não há projeto de teste separado).

**Step 3: Confirmar**

Rode `mcp__plugin_supabase_supabase__list_tables` e confira que `qa_test_runs` aparece com RLS habilitado.

**Step 4: Commit**

```bash
git add supabase/migrations/0022_qa_test_runs.sql
git commit -m "feat(qa): tabela qa_test_runs para log de testes em tempo real"
git push origin main
```

---

### Task 1.2: Helper de escrita (`lib/qa/log.ts`) e de leitura (`lib/qa/queries.ts`)

**Files:**
- Create: `lib/qa/log.ts`
- Create: `lib/qa/queries.ts`

**Step 1: Escrever `lib/qa/log.ts`**

```typescript
import { createServiceClient } from "@/lib/supabase/service";

export type QaTestResult = "ok" | "fail" | "info";

/**
 * Usado só pelo script de QA (fora de uma sessão de usuário) -- nunca
 * importar em código que roda a partir de uma requisição de usuário.
 */
export async function logTestEvent(
  step: string,
  target: string,
  result: QaTestResult,
  detail?: string
) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("qa_test_runs").insert({
    step,
    target,
    result,
    detail: detail ?? null,
  });
  if (error) {
    console.error("Falha ao gravar log de QA:", error.message);
  }
}
```

**Step 2: Escrever `lib/qa/queries.ts`**

```typescript
import { createClient } from "@/lib/supabase/server";

export type QaTestRun = {
  id: string;
  step: string;
  target: string;
  result: "ok" | "fail" | "info";
  detail: string | null;
  created_at: string;
};

export async function listRecentTestRuns(limit = 100): Promise<QaTestRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qa_test_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Falha ao listar qa_test_runs:", error.message);
    return [];
  }
  return data;
}
```

Confira em `lib/supabase/server.ts` se `createClient` é assíncrono (padrão `@supabase/ssr` em Server Components) antes de finalizar — se a assinatura for diferente da usada aqui, ajuste a chamada (mas não a de `service.ts`, que é síncrona, conforme lido em `lib/supabase/service.ts:8`).

**Step 3: Lint**

Run: `npm run lint`
Expected: sem erros novos nesses dois arquivos.

**Step 4: Commit**

```bash
git add lib/qa/log.ts lib/qa/queries.ts
git commit -m "feat(qa): helpers de leitura/escrita do log de testes"
git push origin main
```

---

### Task 1.3: Aba "Testes" com Supabase Realtime

**Files:**
- Create: `components/admin/testes-panel.tsx`

**Step 1: Escrever o componente**

Client component: recebe `initialRuns: QaTestRun[]` via prop (carregado no server em `/admin/page.tsx`, task 2.4), mantém em `useState`, e se inscreve num canal Realtime para novas linhas.

```tsx
"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { QaTestRun } from "@/lib/qa/queries";
import { cn } from "@/lib/utils";

const RESULT_STYLES: Record<QaTestRun["result"], string> = {
  ok: "border-l-primary text-foreground",
  fail: "border-l-destructive text-foreground",
  info: "border-l-border text-muted-foreground",
};

export function TestesPanel({ initialRuns }: { initialRuns: QaTestRun[] }) {
  const [runs, setRuns] = useState(initialRuns);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("qa_test_runs-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "qa_test_runs" },
        (payload) => {
          setRuns((current) => [payload.new as QaTestRun, ...current].slice(0, 200));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma execução de teste registrada ainda.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {runs.map((run) => (
        <div
          key={run.id}
          className={cn(
            "rounded-md border-l-4 bg-card px-3 py-2 text-sm",
            RESULT_STYLES[run.result]
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{run.step}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(run.created_at).toLocaleTimeString("pt-BR")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{run.target}</p>
          {run.detail && <p className="mt-1 text-xs">{run.detail}</p>}
        </div>
      ))}
    </div>
  );
}
```

Confirme se `@/lib/utils` exporta `cn` (usado em `components/ui/dialog.tsx:7`) antes de importar — já é usado no projeto, deve existir.

**Step 2: Lint**

Run: `npm run lint`
Expected: sem erros.

**Step 3: Commit**

```bash
git add components/admin/testes-panel.tsx
git commit -m "feat(qa): painel de testes em tempo real"
git push origin main
```

(A integração deste painel em `/admin` acontece na Fase 2, task 2.4, depois que a estrutura de abas existir.)

---

## Fase 2 — Consolidação do painel admin em abas

### Task 2.1: Componente `Tabs` reutilizável

**Files:**
- Create: `components/ui/tabs.tsx`

**Step 1: Escrever o wrapper**, seguindo o mesmo padrão de `components/ui/dialog.tsx` (funções finas em cima dos primitivos `@base-ui/react`, `data-slot`, `cn` para classes):

```tsx
"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/30 p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
        "data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm",
        "hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("focus-visible:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsPanel }
```

Antes de fechar esta task, rode `Read` em `node_modules/@base-ui/react/tabs/index.parts.d.ts` (ou o `.d.mts` equivalente) e confirme os nomes exatos exportados (`Root`, `List`, `Tab`, `Panel` — o pacote pode nomear o item individual `Tab` ou `Trigger`; ajuste o wrapper para bater com a API real antes de prosseguir) e o atributo de estado selecionado (`data-selected` é uma suposição baseada no padrão de outros componentes base-ui do projeto — confirme no `.d.ts` ou no CSS gerado; se for outro atributo, ex. `data-active`, corrija o wrapper).

**Step 2: Lint**

Run: `npm run lint`
Expected: sem erros.

**Step 3: Commit**

```bash
git add components/ui/tabs.tsx
git commit -m "feat(ui): wrapper Tabs sobre @base-ui/react/tabs"
git push origin main
```

---

### Task 2.2: Extrair conteúdo de Contas sociais para `components/admin/contas-panel.tsx`

**Files:**
- Create: `components/admin/contas-panel.tsx`
- Create: `components/admin/contas-actions.ts` (conteúdo movido de `app/(dashboard)/admin/contas/actions.ts`)
- Create: `components/admin/social-account-form.tsx` (movido de `app/(dashboard)/admin/contas/social-account-form.tsx`)
- Modify: `app/(dashboard)/admin/contas/page.tsx` (vira redirect — task 2.6)
- Delete (nesta task): `app/(dashboard)/admin/contas/social-account-form.tsx`

**Step 1: Ler os arquivos de origem**

Leia `app/(dashboard)/admin/contas/page.tsx`, `app/(dashboard)/admin/contas/actions.ts` e `app/(dashboard)/admin/contas/social-account-form.tsx` por completo antes de copiar — o conteúdo abaixo é um guia, não um substituto pela leitura direta.

**Step 2: Mover `actions.ts` e `social-account-form.tsx`**

```bash
git mv "app/(dashboard)/admin/contas/actions.ts" "components/admin/contas-actions.ts"
git mv "app/(dashboard)/admin/contas/social-account-form.tsx" "components/admin/social-account-form.tsx"
```

Depois de mover, corrija o import de `SocialAccountForm` dentro de `contas-actions.ts` se houver (não deveria — `actions.ts` original não importa o form), e ajuste qualquer import relativo dentro de `social-account-form.tsx` que aponte para `./actions` para `@/components/admin/contas-actions`.

**Step 3: Criar `components/admin/contas-panel.tsx`**

Copie o conteúdo de `app/(dashboard)/admin/contas/page.tsx` (function `ZernioAccountPicker` + `export default async function ContasPage`), renomeie o export default para `ContasPanel`, remova `export const dynamic = "force-dynamic"` (não se aplica a um componente, só a `page.tsx`), atualize os imports:
- `from "./actions"` → `from "@/components/admin/contas-actions"`
- `from "./social-account-form"` → `from "@/components/admin/social-account-form"`
- Remova `import { PageHeader } from "@/components/dashboard/page-header"` e o uso de `<PageHeader ... />` — o cabeçalho da página passa a ser único, gerenciado por `/admin/page.tsx` (task 2.4), a aba não repete título.

**Step 4: Lint**

Run: `npm run lint`
Expected: sem erros de import quebrado.

**Step 5: Commit**

```bash
git add components/admin/contas-panel.tsx components/admin/contas-actions.ts components/admin/social-account-form.tsx
git commit -m "refactor(admin): extrai painel de Contas sociais para components/admin"
git push origin main
```

(A rota antiga `app/(dashboard)/admin/contas/page.tsx` só é convertida em redirect na task 2.6, depois que todas as abas existirem — até lá o app tem os dois: a rota antiga funcionando normalmente e o novo painel ainda não usado em lugar nenhum.)

---

### Task 2.3: Extrair Integrações e Usuários para `components/admin/`

**Files:**
- Create: `components/admin/integracoes-panel.tsx`
- Create: `components/admin/usuarios-panel.tsx`

**Step 1: Integrações**

Copie `app/(dashboard)/admin/integracoes/page.tsx` inteiro para `components/admin/integracoes-panel.tsx`, renomeie `IntegracoesPage` → `IntegracoesPanel`, remova `export const dynamic` e o uso de `<PageHeader>` (mesmo motivo da task 2.2). **Não toque em `app/(dashboard)/admin/integracoes/callback/`** — essa rota é o redirect URI fixo do Google OAuth (`GOOGLE_OAUTH_REDIRECT_URI` em `.env.example:50`), tem que continuar em `/admin/integracoes/callback` exatamente.

**Step 2: Usuários**

Copie `app/(dashboard)/admin/usuarios/page.tsx` inteiro para `components/admin/usuarios-panel.tsx` (é `"use client"`, mantenha a diretiva), renomeie `UsuariosPage` → `UsuariosPanel`, remova `export const dynamic` e `<PageHeader>`. A chamada `fetch("/api/admin/usuarios")` não muda — a API route continua no mesmo lugar.

**Step 3: Lint**

Run: `npm run lint`
Expected: sem erros.

**Step 4: Commit**

```bash
git add components/admin/integracoes-panel.tsx components/admin/usuarios-panel.tsx
git commit -m "refactor(admin): extrai painéis de Integrações e Usuários"
git push origin main
```

---

### Task 2.4: Reescrever `/admin/page.tsx` com abas

**Files:**
- Modify: `app/(dashboard)/admin/page.tsx`

**Step 1: Reescrever a página**

```tsx
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { ContasPanel } from "@/components/admin/contas-panel";
import { IntegracoesPanel } from "@/components/admin/integracoes-panel";
import { TestesPanel } from "@/components/admin/testes-panel";
import { UsuariosPanel } from "@/components/admin/usuarios-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { listRecentTestRuns } from "@/lib/qa/queries";

export const dynamic = "force-dynamic";

const TABS = [
  { value: "contas", label: "Contas sociais" },
  { value: "integracoes", label: "Integrações" },
  { value: "usuarios", label: "Usuários" },
  { value: "testes", label: "Testes" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: TabValue = TABS.some((t) => t.value === tab)
    ? (tab as TabValue)
    : "contas";
  const testRuns = await listRecentTestRuns();

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader title="Painel admin" description="Configurações do sistema." />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          {TABS.map(({ value, label }) => (
            <TabsTab key={value} value={value}>
              {label}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="contas">
          <ContasPanel />
        </TabsPanel>
        <TabsPanel value="integracoes">
          <IntegracoesPanel />
        </TabsPanel>
        <TabsPanel value="usuarios">
          <UsuariosPanel />
        </TabsPanel>
        <TabsPanel value="testes">
          <TestesPanel initialRuns={testRuns} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
```

Confirme na doc de tipos do base-ui (`node_modules/@base-ui/react/tabs/root/TabsRoot.d.ts`) se a prop de valor inicial não controlado é `defaultValue` (padrão comum) — ajuste se o nome real for diferente.

**Step 2: Rodar localmente e conferir visualmente**

Run: `npm run dev`, abra `http://localhost:3000/admin` logado como admin, clique em cada aba e confirme que o conteúdo de Contas/Integrações/Usuários/Testes aparece igual ao das páginas antigas.

**Step 3: Build**

Run: `npm run build`
Expected: build limpo, sem erros de tipo.

**Step 4: Commit**

```bash
git add "app/(dashboard)/admin/page.tsx"
git commit -m "feat(admin): consolida Contas/Integrações/Usuários/Testes em abas"
git push origin main
```

---

### Task 2.5: Atualizar `nav-items.ts`

**Files:**
- Modify: `components/dashboard/nav-items.ts:76-102`

**Step 1: Remover os três itens redundantes do grupo "Administração"**, deixando só "Painel admin":

```typescript
  {
    label: "Administração",
    items: [
      {
        title: "Painel admin",
        url: "/admin",
        icon: Shield,
        roles: ["admin"],
      },
    ],
  },
```

Remova também os imports agora não usados (`Share2`, `Plug`, `Users` de `lucide-react`, linhas 10-12) — confira com `npm run lint` que nada mais os referencia antes de apagar.

**Step 2: Lint**

Run: `npm run lint`
Expected: sem erros, sem imports não usados.

**Step 3: Commit**

```bash
git add components/dashboard/nav-items.ts
git commit -m "refactor(nav): remove itens de admin consolidados em /admin"
git push origin main
```

---

### Task 2.6: Rotas antigas viram redirect

**Files:**
- Modify: `app/(dashboard)/admin/contas/page.tsx`
- Modify: `app/(dashboard)/admin/integracoes/page.tsx`
- Modify: `app/(dashboard)/admin/usuarios/page.tsx`

**Step 1: Substituir cada `page.tsx` por um redirect**

Exemplo para `app/(dashboard)/admin/contas/page.tsx` (mesmo padrão para os outros dois, trocando o valor de `tab`):

```tsx
import { redirect } from "next/navigation";

export default function ContasRedirectPage() {
  redirect("/admin?tab=contas");
}
```

Repita para `integracoes/page.tsx` (`tab=integracoes`) e `usuarios/page.tsx` (`tab=usuarios`). **Não mexa em `app/(dashboard)/admin/integracoes/callback/page.tsx`** (rota fixa do OAuth, task 2.3 já reforçou isso).

**Step 2: Testar manualmente**

Run: `npm run dev`, acesse `http://localhost:3000/admin/contas` diretamente e confirme que redireciona para `/admin?tab=contas` com a aba certa já selecionada. Repita para `/admin/integracoes` e `/admin/usuarios`.

**Step 3: Build**

Run: `npm run build`
Expected: build limpo.

**Step 4: Commit**

```bash
git add "app/(dashboard)/admin/contas/page.tsx" "app/(dashboard)/admin/integracoes/page.tsx" "app/(dashboard)/admin/usuarios/page.tsx"
git commit -m "refactor(admin): rotas antigas redirecionam para /admin com aba"
git push origin main
```

---

## Fase 3 — Acervo → Drive, depois apagar `/acervo`

### Task 3.1: Cadastro manual no Drive

**Files:**
- Create: `components/drive/manual-post-dialog.tsx` (adaptado de `components/acervo/acervo-form-dialog.tsx`)
- Modify: `app/(dashboard)/drive/page.tsx`
- Keep: `lib/acervo/actions.ts` (a função `createAcervoPost` não muda de lugar nem de lógica — só ganha um novo consumidor de UI)

**Step 1: Ler `components/acervo/acervo-form-dialog.tsx` e `app/(dashboard)/drive/page.tsx` por completo**

**Step 2: Criar `components/drive/manual-post-dialog.tsx`**

Copie `components/acervo/acervo-form-dialog.tsx`, renomeie o componente de `AcervoFormDialog` para `ManualPostDialog`, troque o texto do trigger de "Adicionar ao acervo" para "Cadastro manual", e o título do dialog para "Cadastro manual". Mantenha o import de `createAcervoPost` de `@/lib/acervo/actions` (a action em si não muda — ver spec, `content_source: "acervo"` continua sendo o valor gravado, é só a UI que muda de página).

**Step 3: Adicionar o botão em `/drive`**

Em `app/(dashboard)/drive/page.tsx`, importe `ManualPostDialog` e adicione ao lado de `DriveRefreshButton` nas `actions` do `PageHeader`:

```tsx
actions={
  <div className="flex gap-2">
    <ManualPostDialog socialAccounts={socialAccounts} />
    <DriveRefreshButton />
  </div>
}
```

Isso exige buscar `socialAccounts` na página — adicione `listSocialAccounts()` (de `@/lib/posts/queries`, mesmo helper usado em `/aprovacao` e `/conteudo`) ao `Promise.all` junto com `listDriveItems()`.

**Step 4: Testar manualmente**

Run: `npm run dev`, acesse `/drive`, clique em "Cadastro manual", preencha conta social + legenda + arquivo, salve, e confirme (via `mcp__plugin_supabase_supabase__execute_sql` ou pelo `/calendario`/board) que um post com `content_source = 'acervo'` foi criado.

**Step 5: Build**

Run: `npm run build`
Expected: build limpo.

**Step 6: Commit**

```bash
git add components/drive/manual-post-dialog.tsx "app/(dashboard)/drive/page.tsx"
git commit -m "feat(drive): cadastro manual migrado do Acervo"
git push origin main
```

---

### Task 3.2: Validar o agendamento automático antes de apagar

**Files:** nenhum arquivo novo — esta task é só verificação.

**Step 1: Confirmar que o post criado na task 3.1 é elegível para o cron**

Verifique que o post tem `status = 'rascunho'`. Aprove-o manualmente (via `/aprovacao`, que já enxerga posts `content_source = 'acervo'` no board — `components/kanban/board.tsx:26-32` só filtra fora os que já estão `aprovado`/`publicado`, então em `rascunho` ele aparece normalmente) para chegar a `status = 'aprovado', scheduled_at = null`.

**Step 2: Rodar o cron manualmente**

Chame `GET /api/cron/acervo-schedule` localmente (com o header/segredo que a rota espera — confira `app/api/cron/acervo-schedule/route.ts` para o mecanismo de auth) e confirme que o post ganhou um `scheduled_at` dentro de um dos `acervo_daily_slots` configurados em `/admin?tab=contas`.

**Step 3: Registrar o resultado**

Sem commit nesta task — é só confirmação manual antes de prosseguir para o delete. Se falhar, pare e investigue antes de continuar (não prossiga para a task 3.3 com o agendamento automático quebrado).

---

### Task 3.3: Apagar a página Acervo

**Files:**
- Delete: `app/(dashboard)/acervo/` (pasta inteira)
- Delete: `components/acervo/acervo-board.tsx`
- Delete: `components/acervo/filterable-acervo-board.tsx`
- Delete: `components/acervo/acervo-form-dialog.tsx` (substituído por `components/drive/manual-post-dialog.tsx` na task 3.1)
- Delete: `lib/acervo/classify.ts`
- Delete: `lib/acervo/queries.ts`
- Modify: `components/dashboard/nav-items.ts` (remove item "Acervo")
- Modify: `lib/acervo/actions.ts:11-16` (remove `revalidatePath("/acervo")` e a chamada a `revalidatePath("/conteudo")` já vai ser tratada na Fase 4 — nesta task só remova a de `/acervo`)

**Step 1: Grep final antes de apagar**

Rode `Grep` por `from "@/components/acervo/acervo-board"`, `from "@/components/acervo/filterable-acervo-board"`, `from "@/lib/acervo/classify"` e `from "@/lib/acervo/queries"` em todo o projeto. Confirme que os únicos resultados são os próprios arquivos sendo apagados e `app/(dashboard)/acervo/page.tsx`. Se aparecer qualquer outro arquivo, pare e reavalie antes de apagar.

**Step 2: Apagar os arquivos**

```bash
git rm -r "app/(dashboard)/acervo"
git rm components/acervo/acervo-board.tsx components/acervo/filterable-acervo-board.tsx components/acervo/acervo-form-dialog.tsx
git rm lib/acervo/classify.ts lib/acervo/queries.ts
```

**Step 3: Remover o item de nav**

Em `components/dashboard/nav-items.ts`, remova o objeto `{ title: "Acervo", url: "/acervo", icon: Library, ... }` do grupo "Operação" e o import de `Library` de `lucide-react` se não for mais usado em nenhum outro lugar do arquivo.

**Step 4: Limpar `revalidatePath("/acervo")`**

Em `lib/acervo/actions.ts`, dentro de `revalidateAcervoPages()`, remova a linha `revalidatePath("/acervo");`.

**Step 5: Lint e build**

Run: `npm run lint && npm run build`
Expected: sem erros, sem imports quebrados.

**Step 6: Testar manualmente**

Run: `npm run dev`, confirme que `/acervo` não aparece mais no menu e que acessar `http://localhost:3000/acervo` diretamente dá 404 (comportamento padrão do Next quando a rota não existe mais — não precisa de redirect aqui, diferente do admin, pois não há necessidade de preservar bookmarks para uma página que deixou de existir por completo).

**Step 7: Commit**

```bash
git status --short
git add "app/(dashboard)/acervo" components/acervo/acervo-board.tsx components/acervo/filterable-acervo-board.tsx components/acervo/acervo-form-dialog.tsx lib/acervo/classify.ts lib/acervo/queries.ts components/dashboard/nav-items.ts lib/acervo/actions.ts
git commit -m "refactor: remove página Acervo (migrada para Drive)"
git push origin main
```

Confira o `git status --short` antes do `add` — deve mostrar só os arquivos listados acima (mais os `D` de arquivos já removidos via `git rm`). Se `lib/auth/get-current-profile.ts` ou `skills/` aparecerem, NÃO os inclua no `git add`.

---

## Fase 4 — Fila de Posts → Fila de Aprovação, depois apagar `/conteudo`

### Task 4.1: Mover "Novo post" e "Post rápido" para `/aprovacao`

**Files:**
- Modify: `app/(dashboard)/aprovacao/page.tsx`

**Step 1: Reescrever a página**

```tsx
import { FilterableBoard } from "@/components/kanban/filterable-board";
import { PostFormDialog } from "@/components/kanban/post-form-dialog";
import { QuickPostDialog } from "@/components/kanban/quick-post-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";
// Post rápido com vídeo roda síncrono (frames + Whisper + visão GPT-4o) --
// pode levar 20-60s, acima do default da Vercel. Ver mesma nota em
// app/(dashboard)/conteudo/page.tsx antes desta migração.
export const maxDuration = 300;

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();
  const [posts, socialAccounts] = await Promise.all([
    listPosts(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Fila de aprovação"
        description="Revise, edite ou rejeite os posts pendentes de aprovação."
        actions={
          <div className="flex gap-2">
            <QuickPostDialog socialAccounts={socialAccounts} />
            <PostFormDialog
              mode="create"
              socialAccounts={socialAccounts}
              triggerLabel="Novo post"
            />
          </div>
        }
      />

      {profile && (
        <FilterableBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
```

**Step 2: Testar manualmente**

Run: `npm run dev`, acesse `/aprovacao`, confirme que "Post rápido" e "Novo post" aparecem no cabeçalho e funcionam (criar um post manual de teste e um post rápido de vídeo de teste).

**Step 3: Build**

Run: `npm run build`
Expected: build limpo.

**Step 4: Commit**

```bash
git add "app/(dashboard)/aprovacao/page.tsx"
git commit -m "feat(aprovacao): adiciona criação de post (migrado de Fila de Posts)"
git push origin main
```

---

### Task 4.2: Apagar a página Fila de Posts

**Files:**
- Delete: `app/(dashboard)/conteudo/` (pasta inteira)
- Modify: `components/dashboard/nav-items.ts` (remove item "Fila de posts")
- Modify: `lib/posts/actions.ts:23` (remove `revalidatePath("/conteudo")`)
- Modify: `lib/drive/sendToApproval.ts:94` (remove `revalidatePath("/conteudo")`)
- Modify: `lib/acervo/actions.ts` (remove `revalidatePath("/conteudo")` remanescente da Fase 3, se ainda não tiver sido limpo)

**Step 1: Grep final antes de apagar**

Rode `Grep` por `"/conteudo"` em todo o projeto (fora de `docs/`) e confirme que os únicos resultados são as `revalidatePath` listadas acima e `components/dashboard/nav-items.ts`. `FilterableBoard`, `PostFormDialog`, `QuickPostDialog`, `board.tsx`, `post-card.tsx` NÃO devem ser apagados — são compartilhados com `/aprovacao` (confirmado na pesquisa da fase de brainstorming).

**Step 2: Apagar a pasta**

```bash
git rm -r "app/(dashboard)/conteudo"
```

**Step 3: Remover o item de nav**

Em `components/dashboard/nav-items.ts`, remova `{ title: "Fila de posts", url: "/conteudo", icon: LayoutGrid, ... }` do grupo "Operação" e o import de `LayoutGrid` se não for mais usado.

**Step 4: Limpar `revalidatePath("/conteudo")` órfãos**

Remova a linha em `lib/posts/actions.ts:23` e em `lib/drive/sendToApproval.ts:94`. Confirme em `lib/acervo/actions.ts` que a linha equivalente já não existe (deveria ter sido removida junto com a página na Fase 3 — se sobrou, remova agora).

**Step 5: Lint e build**

Run: `npm run lint && npm run build`
Expected: sem erros.

**Step 6: Testar manualmente**

Run: `npm run dev`, confirme que "Fila de posts" não aparece mais no menu, `/conteudo` dá 404, e que criar/editar/aprovar/rejeitar posts em `/aprovacao` continua funcionando normalmente.

**Step 7: Commit**

```bash
git status --short
git add "app/(dashboard)/conteudo" components/dashboard/nav-items.ts lib/posts/actions.ts lib/drive/sendToApproval.ts lib/acervo/actions.ts
git commit -m "refactor: remove página Fila de Posts (funções migradas para Fila de Aprovação)"
git push origin main
```

Confira o `git status --short` antes do `add` — deve mostrar só os arquivos listados acima (mais o `D` de `app/(dashboard)/conteudo` já removido via `git rm`). Se `lib/auth/get-current-profile.ts` ou `skills/` aparecerem, NÃO os inclua no `git add`.

---

## Fase 5 — QA end-to-end

### Task 5.1: Preparar o ambiente de teste

**Step 1:** Confirme que `.env.local` tem `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY` (ou `OPENROUTER_API_KEY`), `ZERNIO_API_KEY`, `CUTPRO_API_KEY` preenchidos (necessários para os fluxos de geração de legenda, edição com template e publicação serem exercitados de verdade).

**Step 2:** Rode `npm run dev` e mantenha rodando durante toda a Fase 5.

**Step 3:** Abra `/admin?tab=testes` num navegador e deixe aberto — é o log em tempo real desta fase.

Nenhum commit nesta task.

---

### Task 5.2: Rodar o QA guiado, um fluxo por vez

Use a skill `webapp-testing` (Playwright) para dirigir o navegador. Para cada fluxo abaixo: (1) chame `logTestEvent(step, target, "info", "iniciando")` antes, (2) execute a ação real na UI logado como `victor-coimbra@hotmail.com`, (3) chame `logTestEvent(step, target, "ok"|"fail", detalhe)` com o resultado. Ao encontrar um bug, corrija na hora (commit próprio por correção, mensagem `fix: <o que quebrou>`), depois repita o passo até obter `"ok"`.

Fluxos a cobrir, na ordem:

1. **Login** com `victor-coimbra@hotmail.com` / `Avenged@7x`.
2. **Geração de legenda — imagem**: subir imagem no painel (ou usar item existente do Drive), digitar contexto, gerar legenda via IA, confirmar 2-3 variações retornadas.
3. **Geração de legenda — vídeo**: subir vídeo sem contexto, confirmar que a IA analisa frames + transcrição e gera legenda sozinha.
4. **Edição com template Cut.Pro**: a partir de um vídeo em `/drive`, acionar a edição com template da casa, confirmar retorno com legendas embutidas.
5. **Cadastro manual no Drive** (novo, Fase 3): já coberto na task 3.1 — reconfirme aqui como parte do QA formal, logando no `qa_test_runs`.
6. **Fila de aprovação — editar**: abrir um post, editar legenda/manchete, salvar.
7. **Fila de aprovação — reenviar**: um post rejeitado, reenviar para aprovação.
8. **Fila de aprovação — regerar arte**: forçar nova renderização da arte de um post de imagem.
9. **Fila de aprovação — excluir**: excluir um post de teste, confirmar remoção.
10. **Fila de aprovação — preview**: abrir o preview (Instagram) de um post.
11. **Fila de aprovação — post rápido** (migrado, Fase 4): criar post rápido de vídeo direto de `/aprovacao`.
12. **Fila de aprovação — novo post**: criar post manual direto de `/aprovacao`.
13. **Admin consolidado** (Fase 2): navegar pelas 4 abas, confirmar que cada uma carrega os dados certos.
14. **Aprovar e agendar**: aprovar um post de teste e confirmar que aparece em `/calendario`.

**Não publicar de verdade na conta real `@puzzlerecordss` via Zernio** — parar antes do clique final de "publicar" em qualquer post de teste, ou usar um post que nunca chega à data agendada, e pedir confirmação explícita ao usuário antes de qualquer ação que dispare uma publicação real (regra de ouro do projeto, reforçada na spec).

Nenhum commit de infraestrutura nesta task — só os commits de correção de bugs encontrados, um por bug.

---

### Task 5.3: Relatório final

**Step 1:** Depois de cobrir todos os 14 fluxos, rode `npm run lint && npm run build` uma última vez para garantir que nenhuma correção da Fase 5 quebrou o build.

**Step 2:** Resuma para o usuário: quantos fluxos passaram de primeira, quais bugs foram encontrados e corrigidos (com link pro commit de cada um), e qualquer coisa que ficou pendente (ex: algo que exigiria uma decisão do usuário, ou uma publicação real que foi propositalmente pulada).

Nenhum commit nesta task — é só o relatório.
