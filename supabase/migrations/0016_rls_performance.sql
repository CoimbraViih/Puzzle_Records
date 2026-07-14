-- Achados de performance do advisor do Supabase (conferência completa da
-- sessão de 13/07/2026, ver PLAN.md M11): índices ausentes em FKs e
-- políticas de RLS reavaliando auth.uid()/is_admin()/has_role() por linha
-- em vez de uma vez por statement (docs: "Auth RLS Initialization Plan").
-- Reescreve as políticas com a mesma lógica, só envolvendo as chamadas em
-- (select ...) para o planner materializar o resultado uma única vez.
-- Não muda nenhuma regra de acesso, só a forma de avaliação.

-- Índices de cobertura para FKs (unindexed_foreign_keys).
create index if not exists drive_ingestions_post_id_idx on public.drive_ingestions (post_id);
create index if not exists posts_approved_by_idx on public.posts (approved_by);
create index if not exists posts_created_by_idx on public.posts (created_by);
create index if not exists posts_social_account_id_idx on public.posts (social_account_id);

-- drive_ingestions
drop policy if exists "drive_ingestions_select_admin" on public.drive_ingestions;
create policy "drive_ingestions_select_admin"
  on public.drive_ingestions for select
  using ((select public.is_admin()));

-- notifications
drop policy if exists "notifications_select_authenticated" on public.notifications;
create policy "notifications_select_authenticated"
  on public.notifications for select
  using ((select auth.uid()) is not null);

drop policy if exists "notifications_update_read_at_authenticated" on public.notifications;
create policy "notifications_update_read_at_authenticated"
  on public.notifications for update
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- post_metrics
drop policy if exists "post_metrics_select_authenticated" on public.post_metrics;
create policy "post_metrics_select_authenticated"
  on public.post_metrics for select
  using ((select auth.uid()) is not null);

-- posts
drop policy if exists "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated"
  on public.posts for select
  using ((select auth.uid()) is not null);

drop policy if exists "posts_insert_conteudo_or_admin" on public.posts;
create policy "posts_insert_conteudo_or_admin"
  on public.posts for insert
  with check (
    created_by = (select auth.uid())
    and ((select public.is_admin()) or (select public.has_role('equipe_conteudo')))
  );

drop policy if exists "posts_update_owner_draft_or_rejected" on public.posts;
create policy "posts_update_owner_draft_or_rejected"
  on public.posts for update
  using (
    (select public.has_role('equipe_conteudo'))
    and (
      created_by = (select auth.uid())
      or (created_by is null and status in ('pendente', 'rejeitado'))
    )
    and status in ('pendente', 'rascunho', 'rejeitado')
  )
  with check (
    (select public.has_role('equipe_conteudo'))
    and (
      created_by = (select auth.uid())
      or (created_by is null and status in ('pendente', 'pendente_aprovacao', 'rejeitado'))
    )
    and status in ('pendente', 'rascunho', 'pendente_aprovacao', 'rejeitado')
  );

drop policy if exists "posts_update_approver_pending" on public.posts;
create policy "posts_update_approver_pending"
  on public.posts for update
  using (
    ((select public.has_role('aprovador')) or (select public.is_admin()))
    and status = 'pendente_aprovacao'
  )
  with check (
    ((select public.has_role('aprovador')) or (select public.is_admin()))
    and status in ('pendente_aprovacao', 'aprovado', 'rejeitado')
  );

drop policy if exists "posts_update_admin_all" on public.posts;
create policy "posts_update_admin_all"
  on public.posts for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "posts_delete_owner_draft" on public.posts;
create policy "posts_delete_owner_draft"
  on public.posts for delete
  using (
    created_by = (select auth.uid())
    and (select public.has_role('equipe_conteudo'))
    and status = 'rascunho'
  );

drop policy if exists "posts_delete_admin" on public.posts;
create policy "posts_delete_admin"
  on public.posts for delete
  using ((select public.is_admin()));

-- profiles
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only"
  on public.profiles for update
  using ((select public.is_admin()) and id <> (select auth.uid()))
  with check ((select public.is_admin()) and id <> (select auth.uid()));

-- social_accounts
drop policy if exists "social_accounts_select_authenticated" on public.social_accounts;
create policy "social_accounts_select_authenticated"
  on public.social_accounts for select
  using ((select auth.uid()) is not null);

drop policy if exists "social_accounts_admin_write" on public.social_accounts;
create policy "social_accounts_admin_write"
  on public.social_accounts for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- templates
drop policy if exists "templates_select_authenticated" on public.templates;
create policy "templates_select_authenticated"
  on public.templates for select
  using ((select auth.uid()) is not null);

drop policy if exists "templates_admin_write" on public.templates;
create policy "templates_admin_write"
  on public.templates for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
