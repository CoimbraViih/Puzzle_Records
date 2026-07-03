-- M3: ingestão do Google Drive cria posts "esqueleto" (sem manchete/legenda
-- ainda, ver M4) — relaxa colunas que só existiam no fluxo manual do M2,
-- adiciona os campos de matéria-prima pro M4 e a tabela de auditoria/dedupe
-- da ingestão.

alter table public.posts
  alter column social_account_id drop not null,
  alter column template drop not null,
  alter column headline drop not null,
  alter column caption drop not null,
  alter column created_by drop not null;

alter table public.posts
  drop constraint posts_status_check;

alter table public.posts
  add constraint posts_status_check
  check (status in ('pendente', 'rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado'));

-- Aviso visível na fila quando o artista/conta social do JSON de metadado
-- não bate com nenhum registro cadastrado (nunca falha em silêncio).
alter table public.posts
  add column ingestion_warning text;

-- Matéria-prima vinda do JSON de metadado do Drive: o M4 usa source_fact
-- pra gerar a manchete/legenda, e track_name pra taggear a música em posts
-- de lançamento (regra do guia de estilo).
alter table public.posts
  add column source_fact text,
  add column track_name text;

-- Trilha de auditoria/dedupe: evita reprocessar um arquivo do Drive mesmo
-- que o move pra subpasta "Processados" falhe depois de já ter criado o
-- post. Só linhas com status='processado' bloqueiam reprocessamento —
-- linhas 'erro' (ex: JSON malformado) não impedem nova tentativa depois
-- que a equipe corrigir o arquivo na pasta.
create table public.drive_ingestions (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  post_id uuid references public.posts (id),
  status text not null check (status in ('processado', 'erro')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.drive_ingestions enable row level security;

-- Log técnico: só admin lê. Escrita só acontece via service role (rota de
-- cron), que ignora RLS — não precisa de policy de insert/update.
create policy "drive_ingestions_select_admin"
  on public.drive_ingestions for select
  using (public.is_admin());
