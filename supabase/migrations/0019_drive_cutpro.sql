-- M16 (D1): espelho da pasta do Google Drive (tabela drive_items) + suporte
-- a template Cut.Pro na tabela templates. Ver docs/CLAUDE.md e PLAN.md#m16;
-- plano técnico completo em docs/plans/2026-07-15-m16-drive-cutpro.md,
-- fonte de verdade de escopo/nomes em PLANO-INTEGRACAO-CUTPRO.md (registro
-- de sessão local, não commitado — auditoria real da API do Cut.Pro feita
-- por Victor em 13/07/2026).
--
-- drive_items é o novo destino do cron drive-sync (ex-drive-ingest, D2): a
-- criação de post deixa de ser automática — vira ação manual "Enviar para
-- aprovação" (D5) a partir desta tabela. edit_status é a máquina de estados
-- do pipeline de edição via Cut.Pro (D4) — clipagem por IA (submitClipping/
-- getSubmission/listClips) seguida de aplicação de template e render
-- assíncrono (applyTemplate/renderClip/getRender/getRenderDownloadUrl) —
-- retomável entre execuções do cron cutpro-pipeline via claim atômico
-- (mesmo idioma de publish-scheduled/poll-video-render). post_id é a trava
-- contra envio duplicado (D5).
--
-- Convenções seguidas (mesmo idioma do resto do schema): colunas de erro
-- *_error nulláveis (nunca falha em silêncio, mesmo padrão de
-- art_generation_error/copy_generation_error/publish_error); trigger
-- set_updated_at (0014); políticas RLS com (select is_admin())/
-- (select auth.uid()) e uma política por ação (0016/0017 — evita
-- "Multiple Permissive Policies" e reavaliação de auth.uid() por linha).

create table public.drive_items (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  drive_metadata_file_id text,
  filename text not null,
  media_type text not null check (media_type in ('image', 'video')),
  media_storage_path text,
  removed_from_drive boolean not null default false,

  caption text,
  caption_variations jsonb,
  caption_error text,

  edit_status text not null default 'nao_editado'
    check (edit_status in (
      'nao_editado', 'enviando', 'clipando', 'aplicando', 'renderizando',
      'editado', 'erro'
    )),
  -- IDs de cada etapa do pipeline Cut.Pro (analyzeVideo não precisa
  -- persistir estado — só startUpload em diante tem continuidade entre
  -- ciclos do cron cutpro-pipeline).
  cutpro_video_id text,
  cutpro_submission_id text,
  cutpro_clip_id text,
  cutpro_template_id text,
  cutpro_render_id text,
  cutpro_error text,
  edited_media_path text,

  post_id uuid references public.posts (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger drive_items_set_updated_at
  before update on public.drive_items
  for each row execute function public.set_updated_at();

create index drive_items_post_id_idx on public.drive_items (post_id);

alter table public.drive_items enable row level security;

-- Leitura: qualquer usuário autenticado (mesma regra de posts/templates —
-- os 3 papéis trabalham na página /drive).
create policy "drive_items_select_authenticated"
  on public.drive_items for select
  using ((select auth.uid()) is not null);

-- Escrita de linha (legenda gerada/editada, avanço de edit_status,
-- post_id ao enviar para aprovação): qualquer autenticado — mesma
-- granularidade de update já usada pela página /drive (sem RLS por papel
-- aqui; a curadoria em si não distingue papel, diferente da fila de
-- aprovação). Nunca cria/apaga linha (isso é do cron, via service-role).
create policy "drive_items_update_authenticated"
  on public.drive_items for update
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

alter table public.templates
  add column provider text not null default 'remotion'
    check (provider in ('remotion', 'cutpro')),
  add column cutpro_template_id text;
