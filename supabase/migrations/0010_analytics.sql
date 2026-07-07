-- M9: métricas por post publicado (coleta periódica via Zernio) e alerta de
-- desconexão de conta social — sinal indireto via falhas consecutivas de
-- publicação, sem endpoint de status dedicado do Zernio (não existe doc
-- oficial ainda). Ver docs/superpowers/specs/2026-07-07-m9-analytics-alertas-design.md.
create table public.post_metrics (
  post_id uuid primary key references public.posts (id),
  likes integer,
  comments integer,
  reach integer,
  collected_at timestamptz not null default now(),
  -- Nunca falha em silêncio: falha na coleta grava o motivo aqui, mesmo
  -- padrão de art_generation_error/publish_error. As últimas métricas boas
  -- conhecidas (likes/comments/reach) são preservadas, não zeradas.
  metrics_error text
);

alter table public.post_metrics enable row level security;

-- Qualquer papel autenticado vê as métricas (mesmo padrão de posts_select_authenticated).
create policy "post_metrics_select_authenticated"
  on public.post_metrics for select
  using (auth.uid() is not null);

-- Sem policy de insert/update para usuários autenticados: só o cron
-- collect-metrics (service-role, ignora RLS) escreve nesta tabela.

alter table public.social_accounts
  add column connection_status text not null default 'conectada'
    check (connection_status in ('conectada', 'desconectada')),
  add column consecutive_publish_failures integer not null default 0,
  add column disconnected_alert_sent_at timestamptz;
