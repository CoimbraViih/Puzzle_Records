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
