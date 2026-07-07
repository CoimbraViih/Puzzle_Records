-- M8: fila do acervo. `content_source` distingue posts vindos da ingestão
-- do Drive (M3) de posts de acervo (upload manual, sem IA/arte gerada) —
-- necessário para o Kanban de /conteudo parar de mostrar acervo aprovado/
-- publicado (que passa a viver só em /acervo) sem afetar posts do Drive.
alter table public.posts
  add column content_source text not null default 'drive'
    check (content_source in ('drive', 'acervo'));

-- Horários-alvo (HH:MM) configurados pelo admin para o agendador
-- distribuído do acervo. Só relevante para contas Instagram por ora
-- (ver docs/superpowers/specs/2026-07-06-m8-acervo-design.md).
alter table public.social_accounts
  add column acervo_daily_slots time[] not null default '{}';
