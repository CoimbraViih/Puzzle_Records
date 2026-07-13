-- M14: repositório de templates de vídeo (tabela própria no Supabase, JSON
-- de configuração renderizado pelo motor Remotion do render-worker) +
-- colunas de acompanhamento do job assíncrono de render em posts. Ver
-- docs/CLAUDE.md (decisão de arquitetura, linha 57) e
-- ANATOMIA-TEMPLATES-VIDEO.md seção 6 (anatomia do template "Puzzle v1").

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  config jsonb not null,
  format text not null default '9:16',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

alter table public.templates enable row level security;

create policy "templates_select_authenticated"
  on public.templates for select
  using (auth.uid() is not null);

create policy "templates_admin_write"
  on public.templates for all
  using (public.is_admin())
  with check (public.is_admin());

-- Só um template pode ser o default por vez.
create unique index templates_single_default
  on public.templates ((is_default))
  where is_default;

alter table public.posts
  add column video_template_id uuid references public.templates (id),
  add column video_render_job_id text,
  add column video_render_status text
    check (video_render_status in ('processing', 'done', 'error'));

insert into public.templates (name, config, format, is_default)
values (
  'Puzzle v1',
  '{
    "titleBox": {
      "color": "#96DB12",
      "textColor": "#000000",
      "position": "bottom-third",
      "durationSeconds": 3
    },
    "captionStyle": "viral",
    "logo": { "enabled": true, "position": "top-right" },
    "progressBar": { "enabled": true, "color": "#96DB12" },
    "footer": { "enabled": false, "text": "SIGA @puzzlerecordss" }
  }'::jsonb,
  '9:16',
  true
);
