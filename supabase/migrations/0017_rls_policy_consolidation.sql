-- Continuação do 0016: fecha os achados restantes do advisor de
-- performance (conferência completa da sessão de 13/07/2026, PLAN.md M11).
-- 1) Duas FKs novas sem índice de cobertura, que só passaram a existir
--    com as tabelas notifications (0013) e templates (0014).
-- 2) "Multiple Permissive Policies": posts (DELETE/UPDATE) e
--    social_accounts/templates (SELECT) tinham 2-3 políticas permissivas
--    avaliadas separadamente para a mesma ação/role. Consolidado em uma
--    única política por ação com as mesmas condições unidas por OR —
--    mesma regra de acesso, uma avaliação em vez de várias.

create index if not exists notifications_social_account_id_idx
  on public.notifications (social_account_id);
create index if not exists posts_video_template_id_idx
  on public.posts (video_template_id);

-- posts: DELETE (posts_delete_admin + posts_delete_owner_draft → 1 policy)
drop policy if exists "posts_delete_admin" on public.posts;
drop policy if exists "posts_delete_owner_draft" on public.posts;
create policy "posts_delete_admin_or_owner_draft"
  on public.posts for delete
  using (
    (select public.is_admin())
    or (
      created_by = (select auth.uid())
      and (select public.has_role('equipe_conteudo'))
      and status = 'rascunho'
    )
  );

-- posts: UPDATE (posts_update_admin_all + posts_update_approver_pending +
-- posts_update_owner_draft_or_rejected → 1 policy)
drop policy if exists "posts_update_admin_all" on public.posts;
drop policy if exists "posts_update_approver_pending" on public.posts;
drop policy if exists "posts_update_owner_draft_or_rejected" on public.posts;
create policy "posts_update_admin_or_approver_or_owner"
  on public.posts for update
  using (
    (select public.is_admin())
    or (
      (select public.has_role('aprovador'))
      and status = 'pendente_aprovacao'
    )
    or (
      (select public.has_role('equipe_conteudo'))
      and (
        created_by = (select auth.uid())
        or (created_by is null and status in ('pendente', 'rejeitado'))
      )
      and status in ('pendente', 'rascunho', 'rejeitado')
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.has_role('aprovador'))
      and status in ('pendente_aprovacao', 'aprovado', 'rejeitado')
    )
    or (
      (select public.has_role('equipe_conteudo'))
      and (
        created_by = (select auth.uid())
        or (created_by is null and status in ('pendente', 'pendente_aprovacao', 'rejeitado'))
      )
      and status in ('pendente', 'rascunho', 'pendente_aprovacao', 'rejeitado')
    )
  );

-- social_accounts: admin_write deixa de cobrir SELECT (já coberto por
-- select_authenticated, mais amplo) — evita 2 políticas permissivas na
-- mesma leitura.
drop policy if exists "social_accounts_admin_write" on public.social_accounts;
create policy "social_accounts_insert_admin"
  on public.social_accounts for insert
  with check ((select public.is_admin()));
create policy "social_accounts_update_admin"
  on public.social_accounts for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "social_accounts_delete_admin"
  on public.social_accounts for delete
  using ((select public.is_admin()));

-- templates: mesmo ajuste do social_accounts acima.
drop policy if exists "templates_admin_write" on public.templates;
create policy "templates_insert_admin"
  on public.templates for insert
  with check ((select public.is_admin()));
create policy "templates_update_admin"
  on public.templates for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "templates_delete_admin"
  on public.templates for delete
  using ((select public.is_admin()));
