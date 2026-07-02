# M1 — Login e multi-usuário — Design

Data: 2026-07-02
Escopo: [PLAN.md](../../../PLAN.md) — milestone M1.

## Objetivo

Acesso controlado por papel: os 3 perfis da Puzzle Records (admin, aprovador, equipe de
conteúdo) conseguem logar via Supabase Auth e são redirecionados/restritos corretamente às
suas áreas do painel.

## Decisões (confirmadas com o usuário)

- **Sem cadastro público.** Só o admin cria contas — não existe tela de "criar conta" aberta.
- **Convite feito pelo próprio painel**, não pelo dashboard do Supabase: tela `/admin/usuarios`
  com formulário (e-mail + papel) que dispara `auth.admin.inviteUserByEmail` via rota de API
  server-only usando a `SUPABASE_SERVICE_ROLE_KEY`.
- **Redirecionamento por papel**: cada papel cai numa rota própria (`/admin`, `/aprovacao`,
  `/conteudo`), com conteúdo placeholder — as telas reais chegam em M2+.
- **Recuperação de senha incluída** nesta etapa (`resetPasswordForEmail`), para não depender do
  admin toda vez que alguém esquecer a senha.
- Papel é armazenado numa tabela própria (`profiles`), não em `user_metadata` — o app já vai
  precisar dessa tabela em M2 (posts referenciam quem aprovou/rejeitou), então criá-la agora
  evita retrabalho.

## Modelo de dados

Tabela `public.profiles` (1:1 com `auth.users`):

| coluna       | tipo                                              | notas                              |
|--------------|----------------------------------------------------|-------------------------------------|
| `id`         | `uuid` PK, FK → `auth.users.id` (`on delete cascade`) |                                    |
| `email`      | `text`                                              | espelha `auth.users.email`         |
| `role`       | `text` com `check` (`admin`,`aprovador`,`equipe_conteudo`) | default `equipe_conteudo` |
| `full_name`  | `text`, nullable                                    |                                     |
| `created_at` | `timestamptz`, default `now()`                      |                                     |

- **Trigger** `on_auth_user_created` (function `handle_new_user`, `security definer`) insere a
  linha em `profiles` sempre que um registro novo é criado em `auth.users`, lendo o papel de
  `raw_user_meta_data->>'role'` (setado no momento do convite).
- **RLS**: habilitado em `profiles`.
  - `select`: usuário lê a própria linha (`id = auth.uid()`) OU é admin (subquery na própria
    tabela verificando `role = 'admin'` para `auth.uid()`).
  - `update`: só admin, e só para atualizar o papel de outros usuários (não a própria linha, para
    evitar auto-promoção acidental via UI — a troca do próprio papel exige outro admin).
  - `insert`/`delete`: bloqueados para todos os papéis client-side; só a rota de API server-only
    (service role, que ignora RLS) cria/remove linhas.

## Fluxo de autenticação

1. **Login** (`/login`) — formulário e-mail/senha via `supabase.auth.signInWithPassword`
   (client component). Erro de credencial mostra mensagem genérica (não revela se o e-mail
   existe).
2. **Convite** (`/admin/usuarios`, só admin) — formulário e-mail + select de papel → POST para
   `/api/admin/usuarios` → rota server-only usa `SUPABASE_SERVICE_ROLE_KEY` para chamar
   `auth.admin.inviteUserByEmail(email, { data: { role } })`. Supabase envia e-mail com link para
   `/auth/definir-senha`, onde o convidado define a senha inicial.
3. **Recuperação de senha** — link "esqueci minha senha" em `/login` → `/auth/recuperar-senha`
   (só pede e-mail) → `resetPasswordForEmail` → e-mail com link para `/auth/redefinir-senha`
   (nova senha).
4. **Logout** — server action chamando `supabase.auth.signOut()`, redireciona para `/login`.

## Proteção de rotas

`middleware.ts` na raiz, usando `@supabase/ssr` (padrão de refresh de sessão a cada request):

- Sem sessão em rota protegida → redirect `/login`.
- Com sessão, busca `role` em `profiles` e valida contra o prefixo da rota:
  - `/admin/**` → só `admin`.
  - `/aprovacao/**` → `admin` ou `aprovador`.
  - `/conteudo/**` → qualquer papel autenticado.
- Acesso à rota de papel errado → redirect para a home do próprio papel (nunca um 403 cru).
- Rotas públicas (sem checagem): `/login`, `/auth/*`.
- `/` (página atual do M0) vira redirecionador puro: sem sessão → `/login`; com sessão → home do
  papel do usuário.

## UI (placeholders — conteúdo real vem em M2+)

- `/login` — e-mail, senha, link "esqueci minha senha".
- `/auth/recuperar-senha`, `/auth/redefinir-senha`, `/auth/definir-senha` — formulários mínimos.
- `/admin` — placeholder "bem-vindo, admin" + link para `/admin/usuarios`.
- `/admin/usuarios` — lista de usuários (e-mail, papel) + formulário de convite.
- `/aprovacao` — placeholder "bem-vindo, aprovador".
- `/conteudo` — placeholder "bem-vindo, equipe de conteúdo".

## Fora de escopo (fica para milestones seguintes)

- Qualquer conteúdo real dentro de `/admin`, `/aprovacao`, `/conteudo` (Kanban é M2).
- Tabelas de posts, contas sociais, artistas, templates (M2).
- Edição do próprio perfil (troca de nome/avatar) — não pedido, não faz parte do critério de
  pronto do M1.
- Permissões granulares além de papel (ex: aprovador só vê posts de certos artistas) — fica para
  Fase 3 do roadmap (`PLAN.md`).

## Critério de pronto

Os 3 papéis conseguem logar e são redirecionados/restritos corretamente: admin convida um
usuário de cada papel, cada um define a senha, loga, e cai na rota certa. Um usuário de
`equipe_conteudo` tentando acessar `/admin` via URL direta é redirecionado sem erro feio. Logout
bloqueia acesso subsequente às rotas protegidas.
