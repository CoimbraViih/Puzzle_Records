-- Artistas da label (referência usada no formulário de post; sem
-- integração com Zernio/Drive ainda).
create table public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text not null,
  created_at timestamptz not null default now()
);

-- Contas sociais onde os posts são publicados (referência; conexão real
-- com Zernio fica para M7/M9).
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  network text not null
    check (network in ('instagram', 'tiktok', 'youtube', 'facebook')),
  handle text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.artists enable row level security;
alter table public.social_accounts enable row level security;

create policy "artists_select_authenticated"
  on public.artists for select
  using (auth.uid() is not null);

create policy "artists_admin_write"
  on public.artists for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "social_accounts_select_authenticated"
  on public.social_accounts for select
  using (auth.uid() is not null);

create policy "social_accounts_admin_write"
  on public.social_accounts for all
  using (public.is_admin())
  with check (public.is_admin());

-- Helper reaproveitável para checar papel do usuário logado dentro de
-- políticas de RLS (mesmo padrão security-definer de public.is_admin(),
-- criada em 0001_profiles.sql).
create or replace function public.has_role(role_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = role_name
  );
$$;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references public.artists (id),
  social_account_id uuid not null references public.social_accounts (id),
  template text not null check (template in ('A', 'B')),
  post_type text not null
    check (post_type in ('viral_geral', 'noticia_funk', 'lancamento')),
  headline text not null,
  caption text not null,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  status text not null
    check (status in ('rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado'))
    default 'rascunho',
  scheduled_at timestamptz,
  rejection_reason text,
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- Qualquer papel autenticado vê o board completo; a UI restringe as
-- ações disponíveis, não a visibilidade dos cards.
create policy "posts_select_authenticated"
  on public.posts for select
  using (auth.uid() is not null);

-- Só equipe de conteúdo (ou admin) cria posts, e sempre como autor de
-- si mesmo.
create policy "posts_insert_conteudo_or_admin"
  on public.posts for insert
  with check (
    created_by = auth.uid()
    and (public.is_admin() or public.has_role('equipe_conteudo'))
  );

-- Equipe de conteúdo só edita os próprios posts em rascunho/rejeitado,
-- e o WITH CHECK trava o status alvo em rascunho/pendente_aprovacao/
-- rejeitado — nunca 'aprovado'. Sem essa trava, o autor conseguiria se
-- auto-aprovar setando status='aprovado' na mesma UPDATE que edita o
-- texto (as políticas permissivas de UPDATE se combinam com OR entre
-- si, então o USING de uma política não amarra o WITH CHECK de outra).
-- 'rejeitado' precisa estar no WITH CHECK porque editar um post
-- rejeitado sem reenviar (ex: só corrigir o texto e salvar) mantém o
-- status atual — sem essa entrada, a UPDATE seria bloqueada mesmo
-- edições que não mudam o status.
create policy "posts_update_owner_draft_or_rejected"
  on public.posts for update
  using (
    created_by = auth.uid()
    and public.has_role('equipe_conteudo')
    and status in ('rascunho', 'rejeitado')
  )
  with check (
    created_by = auth.uid()
    and public.has_role('equipe_conteudo')
    and status in ('rascunho', 'pendente_aprovacao', 'rejeitado')
  );

-- Aprovador decide (ou edita mantendo pendente) só posts pendentes.
create policy "posts_update_approver_pending"
  on public.posts for update
  using (
    (public.has_role('aprovador') or public.is_admin())
    and status = 'pendente_aprovacao'
  )
  with check (
    (public.has_role('aprovador') or public.is_admin())
    and status in ('pendente_aprovacao', 'aprovado', 'rejeitado')
  );

-- Admin tem acesso total, sem restrição de status.
create policy "posts_update_admin_all"
  on public.posts for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "posts_delete_owner_draft"
  on public.posts for delete
  using (
    created_by = auth.uid()
    and public.has_role('equipe_conteudo')
    and status = 'rascunho'
  );

create policy "posts_delete_admin"
  on public.posts for delete
  using (public.is_admin());

-- Bucket privado para mídia dos posts. Leitura via URL assinada gerada
-- no server (lib/posts/queries.ts), nunca acesso público direto.
insert into storage.buckets (id, name, public)
values ('posts-media', 'posts-media', false)
on conflict (id) do nothing;

create policy "posts_media_authenticated_read"
  on storage.objects for select
  using (bucket_id = 'posts-media' and auth.uid() is not null);

create policy "posts_media_authenticated_insert"
  on storage.objects for insert
  with check (bucket_id = 'posts-media' and auth.uid() is not null);
