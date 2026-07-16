-- M16 (D6): monitor de créditos Cut.Pro. notifications.type ganha um novo
-- valor (mesmo padrão de 'conta_desconectada', migration 0013); um singleton
-- guarda se já alertamos nesta "transição" abaixo do limiar, resetado quando
-- o saldo volta a subir (mesmo idioma de connection_status/consecutive_
-- publish_failures em social_accounts, ver publish-scheduled).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('conta_desconectada', 'cutpro_saldo_baixo'));

create table public.cutpro_status (
  id boolean primary key default true check (id),
  low_balance_alerted boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger cutpro_status_set_updated_at
  before update on public.cutpro_status
  for each row execute function public.set_updated_at();

insert into public.cutpro_status (id) values (true);

alter table public.cutpro_status enable row level security;

create policy "cutpro_status_select_authenticated" on public.cutpro_status
  for select using (auth.uid() is not null);
