-- Pivô de arquitetura (10/07/2026): conta única, sem cadastro de
-- artistas; upload direto no painel vira um terceiro valor de
-- content_source. Ver PLAN.md "Pós-M10 — Pivô de arquitetura" e
-- docs/CLAUDE.md.

drop policy if exists "artists_select_authenticated" on public.artists;
drop policy if exists "artists_admin_write" on public.artists;

alter table public.posts drop column if exists artist_id;

drop table if exists public.artists;

alter table public.posts drop constraint if exists posts_content_source_check;
alter table public.posts
  add constraint posts_content_source_check
  check (content_source in ('drive', 'acervo', 'painel'));
