-- M5: arte renderizada gerada pelo Satori (Template A ou B). rendered_art_url
-- guarda o path no bucket posts-media da PNG gerada (não URL completa, já que
-- acesso é via URL assinada pelo server). art_generation_error espelha o padrão
-- de copy_generation_error — falha de arte nunca é silenciosa (ver docs/CLAUDE.md).
alter table public.posts
  add column rendered_art_url text,
  add column art_generation_error text;

comment on column public.posts.rendered_art_url is 'Path no bucket posts-media da arte PNG renderizada (Template A ou B), não URL completa.';
comment on column public.posts.art_generation_error is 'Mensagem de erro da última tentativa de geração de arte, nunca falha em silêncio (mesmo padrão de copy_generation_error).';
