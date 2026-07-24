-- Colunas usadas pelo workflow n8n "Puzzle Records — Drive → Instagram"
-- pra deduplicação real (drive_file_id, em vez da Data Table interna do
-- n8n que parou de ser escrita desde a migração de estado pro Supabase,
-- migration 0031) e pro ramo assíncrono de mover o arquivo original pra
-- "Processados" só depois de publicado (drive_moved_at null = ainda não
-- movido; ver docs/superpowers/specs/2026-07-24-n8n-legenda-app-mover-processados-design.md).
alter table public.posts
  add column drive_file_id text,
  add column drive_moved_at timestamptz;

create index if not exists posts_drive_file_id_idx
  on public.posts (drive_file_id)
  where drive_file_id is not null;
