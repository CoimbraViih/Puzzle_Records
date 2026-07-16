-- Tela de log de testes em tempo real (revisão QA de 2026-07-16, ver
-- docs/superpowers/specs/2026-07-16-revisao-qa-consolidacao-navegacao-design.md).
-- Só o script de QA (service-role, roda fora de uma sessão de usuário)
-- escreve aqui -- mesmo padrão de notifications (migration 0013): sem
-- policy de insert para usuários autenticados.
create table public.qa_test_runs (
  id uuid primary key default gen_random_uuid(),
  step text not null,
  target text not null,
  result text not null check (result in ('ok', 'fail', 'info')),
  detail text,
  created_at timestamptz not null default now()
);

alter table public.qa_test_runs enable row level security;

create policy "qa_test_runs_select_authenticated"
  on public.qa_test_runs for select
  using (auth.uid() is not null);
