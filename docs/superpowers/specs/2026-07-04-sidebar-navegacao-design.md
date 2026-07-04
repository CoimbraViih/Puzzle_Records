# Menu de navegação lateral — Design

Data: 2026-07-04

## Problema

As páginas autenticadas (`/conteudo`, `/aprovacao`, `/admin`, `/admin/artistas`,
`/admin/contas`, `/admin/usuarios`) não compartilham nenhuma navegação. Cada
página renderiza seu próprio cabeçalho solto, com botão "Sair" e badge de papel
duplicados em `/conteudo` e `/aprovacao`, e o único jeito de navegar entre
`/admin`, `/admin/artistas`, `/admin/contas` e `/admin/usuarios` são links soltos
dentro de `app/admin/page.tsx`. Não há como ir de `/conteudo` para `/aprovacao`
(ou vice-versa) sem editar a URL manualmente.

## Objetivo

Adicionar um menu de navegação lateral compartilhado por todas as páginas
autenticadas, com itens filtrados por papel, para que o usuário consiga
transitar entre as áreas às quais tem acesso sem depender da URL.

## Escopo

**Dentro do escopo:**
- Sidebar compartilhada em `/conteudo`, `/aprovacao`, `/admin`,
  `/admin/artistas`, `/admin/contas`, `/admin/usuarios`.
- Itens de menu filtrados por papel, espelhando `roleAllowsRoute()` de
  `lib/supabase/proxy.ts`.
- Estado ativo (rota atual destacada).
- Rodapé da sidebar com nome/e-mail, badge de papel e botão "Sair" —
  substituindo os botões "Sair" duplicados hoje em `/conteudo` e `/aprovacao`.
- Comportamento responsivo: fixa/colapsável (ícone-only) em telas largas,
  drawer off-canvas em telas estreitas — comportamento padrão do componente
  `Sidebar` do shadcn/ui.

**Fora do escopo:**
- `/login`, `/auth/*` e a landing `/` não recebem sidebar.
- Nenhuma mudança em `proxy.ts` ou nas políticas de RLS — a filtragem do menu
  é só cosmética; a proteção real de rota/dado continua onde já está.
- Busca, breadcrumbs, notificações no header — ficam para o M10 (Polimento) do
  `PLAN.md`.
- Novas páginas ou rotas — só organiza a navegação entre as já existentes.

## Arquitetura

### Route group

As páginas hoje em `app/conteudo/`, `app/aprovacao/` e `app/admin/**` são
movidas para dentro de um route group `app/(dashboard)/`:

```
app/(dashboard)/
  layout.tsx          <- novo: layout compartilhado com a sidebar
  conteudo/page.tsx    <- movido, sem mudança de URL
  aprovacao/page.tsx   <- movido, sem mudança de URL
  admin/
    page.tsx
    artistas/page.tsx
    contas/page.tsx
    usuarios/page.tsx
```

Route groups (`(nome)`) não aparecem na URL, então `/conteudo` continua sendo
`/conteudo`. `app/login`, `app/auth/*` e `app/page.tsx` permanecem fora do
grupo e sem a sidebar.

### Componentes novos

- **`components/ui/sidebar.tsx`** (+ `sheet.tsx`, `tooltip.tsx`,
  `separator.tsx`, `skeleton.tsx` como dependências) — instalados via
  `npx shadcn add sidebar`, sem customização de lógica interna.
- **`components/dashboard/app-sidebar.tsx`** (client component) — recebe
  `role: Role` como prop, monta a lista de itens de navegação filtrada por
  papel, usa `usePathname()` para destacar o item ativo.
- **`components/dashboard/user-menu.tsx`** — rodapé da sidebar: nome/e-mail do
  usuário, badge de papel (reaproveitando `ROLE_LABELS`), botão "Sair" que
  invoca a mesma `logout` action de `app/login/actions.ts` já usada hoje.

### Layout do dashboard

`app/(dashboard)/layout.tsx` (server component, `async`):

1. Chama `getCurrentProfile()` uma única vez.
2. Renderiza `<SidebarProvider>` envolvendo `<AppSidebar role={profile.role} email={profile.email} fullName={profile.full_name} />` e `<SidebarInset>{children}</SidebarInset>`.
3. Se `profile` vier `null` (sessão inconsistente), redireciona para `/login` —
   mesmo comportamento de fallback que as páginas individuais já assumiam
   implicitamente ao checar `profile &&` antes de renderizar o Kanban.

### Itens de menu × papel

Espelha exatamente `roleAllowsRoute()` de `lib/supabase/proxy.ts`:

| Item             | Rota               | admin | aprovador | equipe_conteudo |
|------------------|---------------------|:-----:|:---------:|:----------------:|
| Fila de posts    | `/conteudo`          | ✅    | ✅        | ✅               |
| Fila de aprovação| `/aprovacao`         | ✅    | ✅        | ❌               |
| Painel admin     | `/admin`             | ✅    | ❌        | ❌               |
| Artistas         | `/admin/artistas`    | ✅    | ❌        | ❌               |
| Contas sociais   | `/admin/contas`      | ✅    | ❌        | ❌               |
| Usuários         | `/admin/usuarios`    | ✅    | ❌        | ❌               |

### Mudanças nas páginas existentes

Em `app/(dashboard)/conteudo/page.tsx` e `app/(dashboard)/aprovacao/page.tsx`:
remover o badge de papel e o `<form action={logout}>` do cabeçalho (agora
vivem na sidebar), mantendo só o título da página (`h1`) e as ações
específicas da página (ex: botão "Novo post").

Em `app/(dashboard)/admin/page.tsx`: remover os links soltos para
`/admin/usuarios`, `/admin/artistas`, `/admin/contas` e o botão "Sair" (agora
cobertos pela sidebar); manter a mensagem de boas-vindas.

## Testes / verificação manual

- Logar como `equipe_conteudo`: sidebar mostra só "Fila de posts"; navegar
  direto para `/aprovacao` ou `/admin` continua bloqueado pelo proxy (redireciona
  para `/conteudo`), sem esses itens aparecerem no menu.
- Logar como `aprovador`: sidebar mostra "Fila de posts" + "Fila de aprovação",
  sem itens de admin.
- Logar como `admin`: sidebar mostra todos os itens.
- Colapsar a sidebar (ícone-only) e recarregar a página — estado persiste
  (cookie do componente shadcn).
- Reduzir a largura da janela (ou emular mobile) — sidebar vira drawer
  acionado por botão hambúrguer.
- Clicar "Sair" a partir da sidebar em cada papel — comportamento idêntico ao
  botão removido.
- `npm run build`, `npx tsc --noEmit`, `npm run lint` limpos.
