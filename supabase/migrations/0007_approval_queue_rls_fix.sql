-- M6 fix: a excecao de dono nulo criada em 0006 so cobria status = 'pendente'
-- no USING, entao um post do Drive (created_by null) que fosse rejeitado
-- ('rejeitado') ficava sem NINGUEM com permissao de UPDATE via
-- equipe_conteudo — nem o proprio branch de dono (created_by = auth.uid()
-- nunca e verdadeiro para linha sem autor), quebrando o fluxo
-- reject -> revisar -> reenviar especificamente para posts de origem Drive
-- (ver review final do M6). Tambem destrava a segunda escrita de
-- notification_error em submitForApproval, que falhava silenciosamente pelo
-- mesmo motivo (post ja em 'pendente_aprovacao' quando a segunda tentativa
-- de update ocorre).
--
-- Mantido de propósito: o branch de dono nulo NÃO inclui 'rascunho' — um
-- post do Drive sem autor nunca deve virar "adotavel" como rascunho de
-- outra pessoa (decisão da revisão da Task 1).
drop policy "posts_update_owner_draft_or_rejected" on public.posts;

create policy "posts_update_owner_draft_or_rejected"
  on public.posts for update
  using (
    public.has_role('equipe_conteudo')
    and (created_by = auth.uid() or (created_by is null and status in ('pendente', 'rejeitado')))
    and status in ('pendente', 'rascunho', 'rejeitado')
  )
  with check (
    public.has_role('equipe_conteudo')
    and (created_by = auth.uid() or (created_by is null and status in ('pendente', 'pendente_aprovacao', 'rejeitado')))
    and status in ('pendente', 'rascunho', 'pendente_aprovacao', 'rejeitado')
  );
