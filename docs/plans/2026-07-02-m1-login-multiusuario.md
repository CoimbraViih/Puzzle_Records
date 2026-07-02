# M1 — Login e Multi-usuário Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, dispatching a fresh subagent per task with a code-reviewer pass between tasks.

**Goal:** Os 3 papéis da Puzzle Records (admin, aprovador, equipe de conteúdo) conseguem logar via Supabase Auth e são redirecionados/restritos corretamente às suas áreas do painel — sem cadastro público, com convite feito pelo próprio admin e recuperação de senha.

**Architecture:** Tabela `profiles` (1:1 com `auth.users`, populada por trigger) guarda o papel. `proxy.ts` na raiz (equivalente ao `middleware.ts` — ver nota abaixo) faz refresh de sessão e redirecionamento por papel em toda request. Convite de usuário passa por uma rota de API server-only usando a service role key. Login, logout e troca de senha usam Server Actions.

**Tech Stack:** Next.js 16 (App Router), `@supabase/ssr`, `@supabase/supabase-js`, React 19 (`useActionState`), Tailwind + shadcn/ui já configurados no M0.

**⚠️ Nota importante sobre a versão do Next.js:** Este projeto usa Next.js 16, que **renomeou `middleware.ts` para `proxy.ts`** (mesma funcionalidade, arquivo/convenção diferentes — confirmado em `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`). Qualquer tutorial/documentação do Supabase que mencione `middleware.ts` deve ser adaptado para `proxy.ts` com a função exportada como `proxy` (não `middleware`). Antes de escrever ou revisar código de roteamento/sessão, releia esse arquivo de docs.

Spec de referência: `docs/superpowers/specs/2026-07-02-m1-login-multiusuario-design.md`

---

### Task 1: Migração SQL — tabela `profiles`, trigger e RLS

**Agent:** fullstack-developer
**Skills de apoio:** `supabase`, `supabase-postgres-best-practices`

**Files:**
- Create: `supabase/migrations/0001_profiles.sql`

**Passos:**

1. Criar a pasta `supabase/migrations/` se não existir.
2. Criar `supabase/migrations/0001_profiles.sql` com o conteúdo exato:

```sql
-- Tabela de perfis (1:1 com auth.users) guardando o papel de cada usuário.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'equipe_conteudo'
    check (role in ('admin', 'aprovador', 'equipe_conteudo')),
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- security definer: evita recursão de RLS ao checar o papel do usuário
-- logado dentro das próprias políticas de profiles.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- Admin pode atualizar o papel de outros usuários, mas não o próprio
-- (evita auto-promoção acidental via UI).
create policy "profiles_update_admin_only"
  on public.profiles for update
  using (public.is_admin() and id <> auth.uid())
  with check (public.is_admin() and id <> auth.uid());

-- insert/delete ficam sem policy (bloqueados por padrão com RLS habilitado);
-- só a rota de API server-only, usando a service role key, cria/remove linhas.

-- Cria a linha em profiles automaticamente quando um usuário novo é criado
-- em auth.users (via convite do admin). Lê o papel de raw_user_meta_data,
-- setado no momento do convite (auth.admin.inviteUserByEmail).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'equipe_conteudo')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Verificação:** arquivo criado; `supabase status` (se o CLI estiver instalado e o projeto estiver linkado) não é necessário nesta task — a aplicação real da migration fica documentada na Task 11 (`docs/DEPLOY.md`), pois depende de `supabase link`, que exige login interativo.

**Commit:**

```bash
git add supabase/migrations/0001_profiles.sql
git commit -m "feat(db): migration profiles com trigger e RLS por papel"
```

---

### Task 2: Tipos de papel e `Profile`

**Agent:** typescript-pro

**Files:**
- Create: `lib/types/profile.ts`

**Passos:**

1. Criar `lib/types/profile.ts`:

```ts
export const ROLES = ["admin", "aprovador", "equipe_conteudo"] as const;

export type Role = (typeof ROLES)[number];

export interface Profile {
  id: string;
  email: string;
  role: Role;
  full_name: string | null;
  created_at: string;
}

export const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  aprovador: "/aprovacao",
  equipe_conteudo: "/conteudo",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  aprovador: "Aprovador",
  equipe_conteudo: "Equipe de conteúdo",
};
```

**Verificação:** `npx tsc --noEmit` não deve reportar erro relacionado a este arquivo (o projeto ainda não tem consumidores dele até a Task 3).

**Commit:**

```bash
git add lib/types/profile.ts
git commit -m "feat(types): tipos de papel e Profile"
```

---

### Task 3: Sessão Supabase no `proxy.ts` (redirecionamento por papel)

**Agent:** nextjs-architecture-expert
**Skill de apoio:** `supabase`

**Files:**
- Create: `lib/supabase/proxy.ts`
- Create: `proxy.ts` (raiz do repo)

**Passos:**

1. Ler `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` e a seção "Optimistic checks with Proxy" de `node_modules/next/dist/docs/01-app/02-guides/authentication.md` antes de escrever o código (confirma convenção `proxy.ts` + export `proxy` + `config.matcher`).

2. Criar `lib/supabase/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { ROLE_HOME, type Role } from "@/lib/types/profile";

const PUBLIC_ROUTES = ["/login", "/auth"];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function roleAllowsRoute(role: Role, pathname: string) {
  if (pathname.startsWith("/admin")) return role === "admin";
  if (pathname.startsWith("/aprovacao")) {
    return role === "admin" || role === "aprovador";
  }
  if (pathname.startsWith("/conteudo")) return true;
  return true;
}

/**
 * Faz o refresh de sessão do Supabase a cada request e aplica o
 * redirecionamento por papel. Chamado a partir de `proxy.ts` na raiz.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Sem env vars (ex: dev local ainda não configurado) — não bloqueia
    // a navegação, mesma postura tolerante do SupabaseStatus do M0.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user) {
    if (isPublicRoute(pathname) || pathname === "/") {
      return response;
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "equipe_conteudo") as Role;

  if (pathname === "/" || pathname === "/login") {
    return NextResponse.redirect(new URL(ROLE_HOME[role], request.url));
  }

  if (!roleAllowsRoute(role, pathname) && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL(ROLE_HOME[role], request.url));
  }

  return response;
}
```

3. Criar `proxy.ts` na raiz do repo (mesmo nível de `app/`):

```ts
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**Verificação:**

```bash
npm run build
```

Esperado: build passa sem erro. Não é possível testar o redirecionamento real ainda (sem `/login` nem sessão) — isso é validado de ponta a ponta na Task 4 em diante.

**Commit:**

```bash
git add proxy.ts lib/supabase/proxy.ts
git commit -m "feat(auth): proxy.ts com refresh de sessão e redirecionamento por papel"
```

---

### Task 4: Login e logout

**Agent:** fullstack-developer
**Skills de apoio:** `senior-frontend`, `tailwind-patterns`

**Files:**
- Create: `app/login/actions.ts`
- Create: `app/login/page.tsx`

**Passos:**

1. Criar `app/login/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "E-mail ou senha inválidos." };
  }

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

2. Criar `app/login/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { login, type LoginState } from "./actions";

const initialState: LoginState = undefined;

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Entrar</h1>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm text-muted-foreground">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "Entrando..." : "Entrar"}
        </Button>

        <Link
          href="/auth/recuperar-senha"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Esqueci minha senha
        </Link>
      </form>
    </div>
  );
}
```

**Verificação:** `npm run build` passa. Teste manual completo (login de fato) só é possível depois que existir um usuário real — feito na Task 12 (checklist de aceite), depois que o resto do fluxo (convite) existir.

**Commit:**

```bash
git add app/login
git commit -m "feat(auth): página de login e server actions de login/logout"
```

---

### Task 5: Recuperação e definição de senha

**Agent:** fullstack-developer
**Skills de apoio:** `senior-frontend`, `tailwind-patterns`

**Files:**
- Create: `app/auth/actions.ts`
- Create: `components/auth/set-password-form.tsx`
- Create: `app/auth/recuperar-senha/actions.ts`
- Create: `app/auth/recuperar-senha/page.tsx`
- Create: `app/auth/redefinir-senha/page.tsx`
- Create: `app/auth/definir-senha/page.tsx`

**Passos:**

1. Criar `app/auth/actions.ts` (compartilhado entre "definir" e "redefinir", já que tecnicamente é a mesma operação — o usuário chega numa dessas páginas com uma sessão de recovery/convite válida e define a senha):

```ts
"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type UpdatePasswordState = { error?: string } | undefined;

export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) {
    return { error: "A senha precisa ter pelo menos 8 caracteres." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return {
      error: "Não foi possível salvar a senha. O link pode ter expirado.",
    };
  }

  redirect("/");
}
```

2. Criar `components/auth/set-password-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { updatePassword, type UpdatePasswordState } from "@/app/auth/actions";

const initialState: UpdatePasswordState = undefined;

export function SetPasswordForm({ title }: { title: string }) {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    initialState
  );

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm text-muted-foreground">
          Nova senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar senha"}
      </Button>
    </form>
  );
}
```

3. Criar `app/auth/recuperar-senha/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";

export type RecoverState = { message?: string; error?: string } | undefined;

export async function requestPasswordReset(
  _prevState: RecoverState,
  formData: FormData
): Promise<RecoverState> {
  const email = String(formData.get("email") ?? "");

  if (!email) {
    return { error: "Informe um e-mail." };
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/redefinir-senha`,
  });

  // Mensagem genérica de propósito — não revela se o e-mail existe.
  return {
    message: "Se o e-mail existir, você receberá um link de recuperação.",
  };
}
```

4. Criar `app/auth/recuperar-senha/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { requestPasswordReset, type RecoverState } from "./actions";

const initialState: RecoverState = undefined;

export default function RecuperarSenhaPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">
          Recuperar senha
        </h1>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        {state?.message && (
          <p className="text-sm text-muted-foreground">{state.message}</p>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "Enviando..." : "Enviar link"}
        </Button>
      </form>
    </div>
  );
}
```

5. Criar `app/auth/redefinir-senha/page.tsx`:

```tsx
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function RedefinirSenhaPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <SetPasswordForm title="Redefinir senha" />
    </div>
  );
}
```

6. Criar `app/auth/definir-senha/page.tsx`:

```tsx
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function DefinirSenhaPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <SetPasswordForm title="Definir senha" />
    </div>
  );
}
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/auth components/auth
git commit -m "feat(auth): recuperação e definição de senha"
```

---

### Task 6: Rota de API — convite de usuário (admin)

**Agent:** fullstack-developer
**Skill de apoio:** `supabase`

**Files:**
- Create: `app/api/admin/usuarios/route.ts`

**Passos:**

1. Criar `app/api/admin/usuarios/route.ts`:

```ts
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { ROLES, type Role } from "@/lib/types/profile";

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return profile?.role === "admin" ? user : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const email = String(body.email ?? "");
  const role = String(body.role ?? "") as Role;

  if (!email || !ROLES.includes(role)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const serviceClient = getServiceClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { role },
    redirectTo: `${siteUrl}/auth/definir-senha`,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
```

**Verificação:** `npm run build` passa. Teste funcional (chamada real) fica para o checklist de aceite (Task 12), pois exige projeto Supabase linkado com a migration aplicada.

**Commit:**

```bash
git add app/api/admin/usuarios/route.ts
git commit -m "feat(auth): rota de API para convite de usuário (admin)"
```

---

### Task 7: Página `/admin/usuarios`

**Agent:** frontend-developer
**Skills de apoio:** `tailwind-patterns`, `senior-frontend`

**Files:**
- Create: `app/admin/usuarios/page.tsx`

**Passos:**

1. Criar `app/admin/usuarios/page.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/types/profile";

type UserRow = { id: string; email: string; role: Role; created_at: string };

export default function UsuariosPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("equipe_conteudo");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadUsers() {
    const res = await fetch("/api/admin/usuarios");
    if (res.ok) {
      const { users: data } = await res.json();
      setUsers(data);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    const res = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });

    setLoading(false);

    if (res.ok) {
      setStatus("Convite enviado.");
      setEmail("");
      loadUsers();
    } else {
      const { error } = await res.json();
      setStatus(`Erro: ${error}`);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Usuários</h1>

      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm text-muted-foreground">
            E-mail
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm text-muted-foreground">
            Papel
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={loading}>
          {loading ? "Convidando..." : "Convidar"}
        </Button>
      </form>

      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">E-mail</th>
            <th className="py-2">Papel</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-border/50">
              <td className="py-2 text-foreground">{user.email}</td>
              <td className="py-2 text-foreground">
                {ROLE_LABELS[user.role]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/admin/usuarios
git commit -m "feat(auth): tela de gerenciamento de usuários (admin)"
```

---

### Task 8: Páginas placeholder por papel (`/admin`, `/aprovacao`, `/conteudo`)

**Agent:** frontend-developer
**Skill de apoio:** `tailwind-patterns`

**Files:**
- Create: `lib/auth/get-current-profile.ts`
- Create: `app/admin/page.tsx`
- Create: `app/aprovacao/page.tsx`
- Create: `app/conteudo/page.tsx`

**Passos:**

1. Criar `lib/auth/get-current-profile.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/profile";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
}
```

2. Criar `app/admin/page.tsx`:

```tsx
import Link from "next/link";

import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { ROLE_LABELS } from "@/lib/types/profile";

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
      <Link
        href="/admin/usuarios"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Gerenciar usuários
      </Link>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </div>
  );
}
```

3. Criar `app/aprovacao/page.tsx`:

```tsx
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
        {profile ? ROLE_LABELS[profile.role] : "Aprovador"}
      </span>
      <h1 className="text-3xl font-semibold text-foreground">
        Bem-vindo, aprovador
      </h1>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </div>
  );
}
```

4. Criar `app/conteudo/page.tsx`:

```tsx
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export default async function ConteudoPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
        {profile ? ROLE_LABELS[profile.role] : "Equipe de conteúdo"}
      </span>
      <h1 className="text-3xl font-semibold text-foreground">
        Bem-vindo, equipe de conteúdo
      </h1>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </div>
  );
}
```

**Nota:** `app/page.tsx` (hello-world do M0) **não precisa ser modificado** — o `proxy.ts` da Task 3 já redireciona qualquer request autenticada para a home do papel e qualquer request não-autenticada para `/login` antes de a página `/` renderizar. `/` só continua aparecendo de fato quando as env vars do Supabase estão ausentes (dev local sem `.env.local`), que é exatamente o comportamento de fallback gracioso que o M0 já implementou.

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add lib/auth app/admin/page.tsx app/aprovacao app/conteudo
git commit -m "feat(auth): páginas placeholder por papel (admin/aprovação/conteúdo)"
```

---

### Task 9: `.env.example` — `NEXT_PUBLIC_SITE_URL` e service role key em uso

**Agent:** devops-engineer

**Files:**
- Modify: `.env.example`

**Passos:**

1. Adicionar `NEXT_PUBLIC_SITE_URL` logo abaixo das variáveis do Supabase, e atualizar o comentário da `SUPABASE_SERVICE_ROLE_KEY` (deixa de estar "reservada" — agora é usada na rota de convite):

```diff
 # Supabase — Project Settings > API (https://app.supabase.com)
 NEXT_PUBLIC_SUPABASE_URL=
 NEXT_PUBLIC_SUPABASE_ANON_KEY=
-# Chave de service role — Project Settings > API > service_role (secreta).
-# Reservada para jobs administrativos futuros; não usada nesta etapa.
+# Chave de service role — Project Settings > API > service_role (secreta).
+# Usada pela rota /api/admin/usuarios para convidar novos usuários
+# (auth.admin.inviteUserByEmail). Nunca expor ao client.
 SUPABASE_SERVICE_ROLE_KEY=
+# URL pública do app (usada nos links de e-mail de convite/recuperação de
+# senha). Em produção, a URL do deploy na Vercel; em dev, http://localhost:3000.
+NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Verificação:** leitura do arquivo — nenhum comando a rodar.

**Commit:**

```bash
git add .env.example
git commit -m "docs: NEXT_PUBLIC_SITE_URL e uso real da service role key no .env.example"
```

---

### Task 10: `docs/DEPLOY.md` — aplicar migration e criar o primeiro admin

**Agent:** devops-engineer
**Skill de apoio:** `supabase`

**Files:**
- Modify: `docs/DEPLOY.md`

**Passos:**

1. Adicionar uma seção nova ao final de `docs/DEPLOY.md` (não alterar o conteúdo já existente do M0):

```markdown
## Pós-M1: aplicar a migration e criar o primeiro admin

1. Com o projeto já linkado (`npx supabase link --project-ref <seu-project-ref>`,
   passo já documentado acima), aplique a migration:
   ```
   npx supabase db push
   ```
2. Configure `NEXT_PUBLIC_SITE_URL` no `.env.local` e nas env vars da Vercel
   com a URL real do deploy (ex: `https://puzzle-records-agent.vercel.app`).
3. Bootstrap do primeiro admin — como não existe cadastro público, o primeiro
   usuário precisa ser criado manualmente uma única vez:
   - No dashboard do Supabase: **Authentication > Users > Add user**, crie o
     usuário com e-mail e senha.
   - No **SQL Editor**, rode (troque o e-mail):
     ```sql
     update public.profiles set role = 'admin' where email = 'seu-email@puzzlerecords.com';
     ```
   - A partir daí, esse admin consegue convidar os demais usuários direto
     pela tela `/admin/usuarios` do painel.
```

**Verificação:** leitura do arquivo — nenhum comando a rodar (todos os comandos aqui exigem login interativo do usuário).

**Commit:**

```bash
git add docs/DEPLOY.md
git commit -m "docs: instruções pós-M1 — aplicar migration e criar o primeiro admin"
```

---

### Task 11: Revisão de código

**Agent:** code-reviewer

**Escopo:** revisar todo o diff do M1 (Tasks 1–10) contra a spec
`docs/superpowers/specs/2026-07-02-m1-login-multiusuario-design.md`. Focar em:

- RLS: confirmar que não há caminho para um não-admin ler/editar papel de outro
  usuário, e que `insert`/`delete` em `profiles` realmente dependem só da
  service role key (sem policy client-side acidental).
- `proxy.ts`: confirmar que rotas protegidas nunca vazam conteúdo para usuário
  sem sessão nem para papel errado (checar `roleAllowsRoute` para os 3 papéis
  e para rotas não mapeadas).
- Rota `/api/admin/usuarios`: confirmar que `requireAdmin()` é chamado em
  `GET` e `POST`, e que a service role key nunca é usada num client component.
- Consistência de nomes de rota entre `ROLE_HOME`, o `proxy.ts` e as páginas
  criadas.
- Nada de código morto (ex: se algo de `app/page.tsx` ficou inconsistente com
  a Nota da Task 8).

Rodar `npm run build` e `npx tsc --noEmit` como parte da revisão.

**Se houver findings:** corrigir inline nas mesmas tasks/arquivos, sem criar
uma "Task 11.5" — o objetivo é fechar o M1 limpo.

---

### Task 12: Checklist de aceite manual (bate com o critério do PLAN.md)

**Agent:** devops-engineer (execução manual guiada — vários passos exigem
`supabase link`/e-mails reais, então esta task é majoritariamente um roteiro
para o usuário rodar, não automação)

**Roteiro:**

1. Rodar `npx supabase db push` (Task 10) com o projeto linkado.
2. Criar o primeiro admin manualmente (Task 10) e logar em `/login`.
3. Confirmar redirecionamento automático para `/admin`.
4. Em `/admin/usuarios`, convidar um e-mail de teste como `aprovador` e outro
   como `equipe_conteudo`.
5. Em cada e-mail de convite, clicar no link → cair em `/auth/definir-senha` →
   definir senha → confirmar redirecionamento para a home do papel certo
   (`/aprovacao` ou `/conteudo`).
6. Logado como `equipe_conteudo`, tentar acessar `/admin` direto pela URL →
   confirmar redirecionamento para `/conteudo` sem erro feio.
7. Clicar em "Sair" em qualquer papel → confirmar volta para `/login` e que
   acessar qualquer rota protegida direto pela URL redireciona de volta para
   `/login`.
8. Testar "esqueci minha senha" em `/login` com o e-mail do admin → confirmar
   recebimento do e-mail e que o link leva a `/auth/redefinir-senha`.

**Critério de pronto do M1 (do PLAN.md):** os 3 papéis conseguem logar e são
redirecionados/restritos corretamente — confirmado pelos passos 3–6 acima.

---

### Task 13: Commit final do M1

**Agent:** devops-engineer

**Passos:**

1. `git status` — confirmar que tudo das Tasks 1–10 já foi commitado
   individualmente (nenhum commit "catch-all" necessário).
2. Não fazer push. Informar ao usuário que os commits estão prontos localmente
   e perguntar se deve dar push para `origin`.

**Verificação:** `git log --oneline` mostra os commits das Tasks 1–10 em
sequência; `git status` limpo.
