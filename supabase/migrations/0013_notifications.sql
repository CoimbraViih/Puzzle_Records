-- M13 (piloto assistido): o alerta ativo de desconexão de conta social
-- (M9) dependia do Resend, removido do projeto em 09/07/2026 -- desde
-- então uma desconexão só é visível passivamente no dashboard (ver
-- docs/CLAUDE.md, decisão da sessão de 09/07). Rodar 2 semanas de piloto
-- sem alerta ativo é o "pior cenário operacional" descrito no CLAUDE.md
-- (posts perdidos sem aviso), então esse canal precisa existir antes do
-- piloto. Centro de notificações in-app: zero dependência externa, zero
-- env var nova, a equipe já usa o painel todo dia.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('conta_desconectada')),
  message text not null,
  social_account_id uuid references public.social_accounts (id),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.notifications enable row level security;

-- Mesmo padrão de post_metrics/post_metrics_select_authenticated: qualquer
-- papel autenticado lê e marca como lida (não há noção de destinatário
-- individual -- conta única, equipe pequena, todo mundo vê tudo).
create policy "notifications_select_authenticated"
  on public.notifications for select
  using (auth.uid() is not null);

create policy "notifications_update_read_at_authenticated"
  on public.notifications for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Sem policy de insert para usuários autenticados: só o cron
-- publish-scheduled (service-role, ignora RLS) cria notificações.
