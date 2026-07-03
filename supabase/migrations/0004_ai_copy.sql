-- M4: manchete/legenda geradas pela OpenAI. copy_variations guarda as 2-3
-- variações retornadas pelo modelo (cada item: {headline, caption});
-- headline/caption (colunas já existentes desde o M2) sempre refletem a
-- variação selecionada. copy_generation_error espelha o ingestion_warning
-- do M3 — falha de geração nunca é silenciosa (ver docs/CLAUDE.md).
alter table public.posts
  add column copy_variations jsonb,
  add column copy_generation_error text;
