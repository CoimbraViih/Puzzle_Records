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
