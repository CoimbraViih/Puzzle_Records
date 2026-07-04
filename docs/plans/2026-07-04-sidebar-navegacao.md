# Menu de Navegação Lateral — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar uma sidebar de navegação compartilhada em todas as páginas autenticadas (`/conteudo`, `/aprovacao`, `/admin/*`), com itens filtrados por papel, colapsável em telas largas e off-canvas no mobile.

**Architecture:** As páginas atuais são movidas para um route group `app/(dashboard)/` (sem mudança de URL) com um `layout.tsx` compartilhado que monta o componente oficial `Sidebar` do shadcn/ui em torno de `{children}`. Um componente `AppSidebar` (client) recebe o papel do usuário via prop e filtra os itens de menu; o rodapé da sidebar substitui os botões "Sair" duplicados que hoje vivem em `/conteudo` e `/aprovacao`.

**Tech Stack:** Next.js App Router (route groups), shadcn/ui (`style: base-nova`, primitivas `@base-ui/react`), Tailwind v4, lucide-react.

**Nota sobre testes:** este repositório não tem test runner configurado (sem Jest/Vitest/Playwright em `package.json`) — o padrão já estabelecido nos milestones do `PLAN.md` é verificar com `npm run build`, `npx tsc --noEmit`, `npm run lint` e um checklist manual. Este plano segue o mesmo padrão em vez de forçar TDD onde não há infraestrutura de teste.

**Antes de começar:** confirme que está numa worktree isolada (não direto na `main`) — há mudanças não commitadas em `lib/auth/get-current-profile.ts` e `lib/posts/queries.ts` na árvore atual que não fazem parte deste trabalho e não devem ser tocadas ou commitadas junto.

---

### Task 1: Instalar o componente Sidebar do shadcn/ui

**Files:**
- Modify: `components.json` (o CLI pode registrar a adição, sem mudança manual esperada)
- Create: `components/ui/sidebar.tsx` (+ dependências que o CLI trouxer, ex: `components/ui/sheet.tsx`, `components/ui/tooltip.tsx`, `components/ui/separator.tsx`, `components/ui/skeleton.tsx`, `components/ui/input.tsx` — só os que ainda não existirem)

**Step 1: Rodar o CLI**

Run: `npx shadcn@latest add sidebar`

Expected: CLI detecta `components.json` (`style: base-nova`, `iconLibrary: lucide`), instala `components/ui/sidebar.tsx` e qualquer dependência que faltar. As variáveis CSS `--sidebar*` já existem em `app/globals.css` (linhas 13-20, 76-83, 111-118), então o CLI não deve precisar tocar nesse arquivo — se ele tentar sobrescrever essas linhas, revise o diff antes de aceitar para não perder o acento verde-limão já configurado no tema dark (`--sidebar-primary: oklch(0.814 0.213 129.11)`).

**Step 2: Verificar que o projeto ainda builda**

Run: `npx tsc --noEmit`

Expected: sem erros novos (o componente ainda não é usado em lugar nenhum, então só precisa compilar isoladamente).

**Step 3: Commit**

```bash
git add components.json components/ui/sidebar.tsx components/ui/sheet.tsx components/ui/tooltip.tsx components/ui/separator.tsx components/ui/skeleton.tsx components/ui/input.tsx
git commit -m "chore: adiciona componente Sidebar do shadcn/ui"
```

(ajuste a lista de arquivos ao que o CLI de fato gerar — rode `git status` antes do `add` para conferir.)

---

### Task 2: Mover páginas autenticadas para o route group `(dashboard)`

**Files:**
- Move: `app/conteudo/page.tsx` → `app/(dashboard)/conteudo/page.tsx`
- Move: `app/aprovacao/page.tsx` → `app/(dashboard)/aprovacao/page.tsx`
- Move: `app/admin/page.tsx` → `app/(dashboard)/admin/page.tsx`
- Move: `app/admin/artistas/page.tsx`, `actions.ts`, `artist-form.tsx` → `app/(dashboard)/admin/artistas/`
- Move: `app/admin/contas/page.tsx`, `actions.ts`, `social-account-form.tsx` → `app/(dashboard)/admin/contas/`
- Move: `app/admin/usuarios/page.tsx` → `app/(dashboard)/admin/usuarios/`

Route groups (pasta entre parênteses) não entram na URL — `/conteudo` continua `/conteudo`. Todos os imports no projeto usam o alias `@/...` a partir da raiz, então mover essas páginas não quebra nenhum import existente.

**Step 1: Mover os arquivos preservando histórico do git**

```bash
mkdir -p "app/(dashboard)/admin/artistas" "app/(dashboard)/admin/contas" "app/(dashboard)/admin/usuarios"
git mv app/conteudo/page.tsx "app/(dashboard)/conteudo/page.tsx"
git mv app/aprovacao/page.tsx "app/(dashboard)/aprovacao/page.tsx"
git mv app/admin/page.tsx "app/(dashboard)/admin/page.tsx"
git mv app/admin/artistas/page.tsx "app/(dashboard)/admin/artistas/page.tsx"
git mv app/admin/artistas/actions.ts "app/(dashboard)/admin/artistas/actions.ts"
git mv app/admin/artistas/artist-form.tsx "app/(dashboard)/admin/artistas/artist-form.tsx"
git mv app/admin/contas/page.tsx "app/(dashboard)/admin/contas/page.tsx"
git mv app/admin/contas/actions.ts "app/(dashboard)/admin/contas/actions.ts"
git mv app/admin/contas/social-account-form.tsx "app/(dashboard)/admin/contas/social-account-form.tsx"
git mv app/admin/usuarios/page.tsx "app/(dashboard)/admin/usuarios/page.tsx"
```

**Step 2: Confirmar que as pastas antigas ficaram vazias e remover**

Run: `find app/admin app/conteudo app/aprovacao -type f` (Bash) ou equivalente PowerShell

Expected: nenhuma saída (todos os arquivos já foram movidos pelo `git mv`; o Next.js remove diretórios vazios automaticamente do build, não precisa `rmdir` manual).

**Step 3: Rodar o build para confirmar que as rotas ainda resolvem**

Run: `npm run build`

Expected: build passa, `/conteudo`, `/aprovacao`, `/admin`, `/admin/artistas`, `/admin/contas`, `/admin/usuarios` aparecem na lista de rotas geradas, sem o segmento `(dashboard)` no path.

**Step 4: Commit**

```bash
git commit -m "refactor: move páginas autenticadas para route group (dashboard)"
```

---

### Task 3: Criar a config de itens de navegação por papel

**Files:**
- Create: `components/dashboard/nav-items.ts`

**Step 1: Escrever o arquivo**

```typescript
import type { LucideIcon } from "lucide-react";
import { CheckSquare, Disc3, LayoutGrid, Share2, Shield, Users } from "lucide-react";

import type { Role } from "@/lib/types/profile";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  roles: Role[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Fila de posts",
    url: "/conteudo",
    icon: LayoutGrid,
    roles: ["admin", "aprovador", "equipe_conteudo"],
  },
  {
    title: "Fila de aprovação",
    url: "/aprovacao",
    icon: CheckSquare,
    roles: ["admin", "aprovador"],
  },
  {
    title: "Painel admin",
    url: "/admin",
    icon: Shield,
    roles: ["admin"],
  },
  {
    title: "Artistas",
    url: "/admin/artistas",
    icon: Disc3,
    roles: ["admin"],
  },
  {
    title: "Contas sociais",
    url: "/admin/contas",
    icon: Share2,
    roles: ["admin"],
  },
  {
    title: "Usuários",
    url: "/admin/usuarios",
    icon: Users,
    roles: ["admin"],
  },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
```

Essa lista espelha exatamente `roleAllowsRoute()` em `lib/supabase/proxy.ts:14-23` — se as regras de acesso mudarem lá, atualize aqui também.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: sem erros.

**Step 3: Commit**

```bash
git add components/dashboard/nav-items.ts
git commit -m "feat: config de itens de navegação da sidebar por papel"
```

---

### Task 4: Criar o componente `AppSidebar`

**Files:**
- Create: `components/dashboard/app-sidebar.tsx`

**Step 1: Escrever o componente**

```typescript
"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logout } from "@/app/login/actions";
import { navItemsForRole } from "@/components/dashboard/nav-items";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { Profile } from "@/lib/types/profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export function AppSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const items = navItemsForRole(profile.role);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <span className="px-2 py-1 text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          Puzzle Records
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex flex-col gap-0.5 px-2 py-1 group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium text-sidebar-foreground">
                {profile.full_name ?? profile.email}
              </span>
              <span className="text-xs text-muted-foreground">
                {ROLE_LABELS[profile.role]}
              </span>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logout}>
              <SidebarMenuButton type="submit" tooltip="Sair">
                <LogOut />
                <span>Sair</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
```

Nota: `pathname === item.url` é suficiente aqui porque todas as rotas de nível admin (`/admin/artistas` etc.) são folhas — não há sub-rotas abaixo delas que precisariam de um match por prefixo. Se isso mudar no futuro, troque por `pathname.startsWith(item.url)` com cuidado para `/admin` não capturar `/admin/artistas`.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: sem erros (o componente ainda não está montado em nenhuma página, mas deve compilar isoladamente). Se `SidebarMenuButton` não aceitar `type="submit"` diretamente no TS, ajuste envolvendo com `asChild` e um `<button>` interno — confira a assinatura gerada em `components/ui/sidebar.tsx` pelo Task 1 antes de decidir.

**Step 3: Commit**

```bash
git add components/dashboard/app-sidebar.tsx
git commit -m "feat: componente AppSidebar com navegação e logout"
```

---

### Task 5: Criar o layout do route group `(dashboard)`

**Files:**
- Create: `app/(dashboard)/layout.tsx`

**Step 1: Escrever o layout**

```typescript
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <AppSidebar profile={profile} />
      <SidebarInset>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
          <SidebarTrigger />
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
```

O botão `SidebarTrigger` só aparece em telas estreitas (`md:hidden`) — em telas largas, o padrão do componente shadcn já expõe um jeito de colapsar a sidebar direto no header dela (definido no Task 4/componente base); confirme visualmente no Task 8 e adicione um `SidebarTrigger` fixo ali também se o componente base não trouxer um por padrão.

**Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`

Expected: sem erros. As páginas dentro do grupo (`conteudo`, `aprovacao`, `admin/*`) ainda não foram ajustadas, então o preview visual só fica correto no Task 8 — por enquanto só confirme que compila.

**Step 3: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat: layout compartilhado do route group (dashboard) com sidebar"
```

---

### Task 6: Remover cabeçalho duplicado de `/conteudo`

**Files:**
- Modify: `app/(dashboard)/conteudo/page.tsx`

**Step 1: Simplificar o cabeçalho**

Substituir o bloco atual (linhas 1-43 do arquivo original, que importava `logout`, `Button`, `ROLE_LABELS` só para o badge/botão duplicados):

```typescript
import { KanbanBoard } from "@/components/kanban/board";
import { PostFormDialog } from "@/components/kanban/post-form-dialog";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function ConteudoPage() {
  const profile = await getCurrentProfile();
  const [posts, artists, socialAccounts] = await Promise.all([
    listPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">
          Fila de posts
        </h1>
        <PostFormDialog
          mode="create"
          artists={artists}
          socialAccounts={socialAccounts}
          triggerLabel="Novo post"
        />
      </div>

      {profile && (
        <KanbanBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          artists={artists}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
```

O `getCurrentProfile()` continua chamado aqui porque a página precisa de `profile.id`/`profile.role` para o `KanbanBoard` — só o badge de papel e o botão "Sair" saem, não a chamada em si.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: sem erros, sem imports não usados (`logout`, `Button`, `ROLE_LABELS` não devem mais aparecer neste arquivo).

**Step 3: Commit**

```bash
git add "app/(dashboard)/conteudo/page.tsx"
git commit -m "refactor: remove cabeçalho duplicado de /conteudo (agora na sidebar)"
```

---

### Task 7: Remover cabeçalho duplicado de `/aprovacao`

**Files:**
- Modify: `app/(dashboard)/aprovacao/page.tsx`

**Step 1: Simplificar o cabeçalho**

```typescript
import { KanbanBoard } from "@/components/kanban/board";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();
  const [posts, artists, socialAccounts] = await Promise.all([
    listPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">
        Fila de aprovação
      </h1>

      {profile && (
        <KanbanBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          artists={artists}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
```

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: sem erros, sem imports não usados (`logout`, `Button`, `ROLE_LABELS`).

**Step 3: Commit**

```bash
git add "app/(dashboard)/aprovacao/page.tsx"
git commit -m "refactor: remove cabeçalho duplicado de /aprovacao (agora na sidebar)"
```

---

### Task 8: Remover links soltos e logout de `/admin`

**Files:**
- Modify: `app/(dashboard)/admin/page.tsx`

**Step 1: Simplificar a página**

```typescript
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
        {profile ? ROLE_LABELS[profile.role] : "Admin"}
      </span>
      <h1 className="text-3xl font-semibold text-foreground">
        Bem-vindo, admin
      </h1>
    </div>
  );
}
```

Os links para `/admin/usuarios`, `/admin/artistas`, `/admin/contas` e o botão "Sair" saem daqui porque agora vivem na sidebar. O badge de papel no centro da página fica (é diferente do badge da sidebar — funciona como um resumo da página de boas-vindas, não navegação).

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: sem erros, sem import de `Link`, `Button` ou `logout` sobrando.

**Step 3: Commit**

```bash
git add "app/(dashboard)/admin/page.tsx"
git commit -m "refactor: remove links e logout duplicados de /admin (agora na sidebar)"
```

---

### Task 9: Verificação final e checklist manual

**Files:** nenhum (só verificação)

**Step 1: Rodar a suíte de verificação estática**

Run: `npm run build && npx tsc --noEmit && npm run lint`

Expected: as três saem limpas (nenhum erro novo; warnings pré-existentes de `<img>` nos templates Satori do M5 não contam).

**Step 2: Checklist manual (rodar `npm run dev` e testar no navegador)**

- [ ] Logar como `equipe_conteudo`: sidebar mostra só "Fila de posts"; digitar `/aprovacao` ou `/admin` na URL continua redirecionando para `/conteudo` (comportamento do `proxy.ts`, não deve mudar).
- [ ] Logar como `aprovador`: sidebar mostra "Fila de posts" + "Fila de aprovação", sem itens de admin.
- [ ] Logar como `admin`: sidebar mostra os 6 itens.
- [ ] Clicar em cada item do menu: navega para a rota certa e destaca o item ativo.
- [ ] Colapsar a sidebar (botão de colapso do componente shadcn) e recarregar a página (F5): estado de colapso persiste.
- [ ] Redimensionar a janela para largura de celular (ou usar o modo device do DevTools): sidebar vira drawer, acionado pelo botão hambúrguer (`SidebarTrigger`) que aparece no header mobile.
- [ ] Clicar "Sair" a partir do rodapé da sidebar em cada papel: desloga e redireciona para `/login`, igual ao comportamento anterior.
- [ ] Confirmar visualmente que o acento verde-limão (`#96DB12`) aparece no item de menu ativo (herdado de `--sidebar-primary` no tema dark).

**Step 3: Commit final (se algo precisar de ajuste do checklist)**

```bash
git add -A
git commit -m "fix: ajustes de checklist manual da sidebar"
```

(só necessário se o checklist manual revelar algo a corrigir; se tudo passar de primeira, não há o que commitar aqui.)

---

## Fora de escopo (confirmado na spec)

- Nenhuma mudança em `lib/supabase/proxy.ts` ou nas políticas de RLS.
- Sem busca, breadcrumbs ou notificações no header (M10 do `PLAN.md`).
- `app/admin/artistas/page.tsx`, `app/admin/contas/page.tsx`, `app/admin/usuarios/page.tsx` só são movidos, sem mudança de conteúdo interno (suas tabelas/formulários já são específicos da página, sem duplicação com a sidebar).
