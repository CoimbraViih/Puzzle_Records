-- M16 (D2): contexto inicial capturado no mirror (mesmo papel de
-- source_fact/track_name/post_type em posts), consumido pela geração de
-- legenda (Task 3) — sem isso a página /drive perderia o `fato` do .json
-- do Drive que a ingestão automática hoje já lê.
alter table public.drive_items
  add column post_type text not null default 'viral_geral'
    check (post_type in ('viral_geral', 'noticia_funk', 'lancamento')),
  add column source_fact text,
  add column track_name text;
