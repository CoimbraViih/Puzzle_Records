-- Antes, uma falha ao baixar/subir a mídia de um arquivo do Drive
-- (lib/drive/mirrorFile.ts) fazia mirrorFilePair sair em silêncio sem
-- criar nenhuma linha em drive_items -- o item simplesmente nunca
-- aparecia em /drive, sem nenhum sinal visível pro usuário além do log
-- de runtime da Vercel (achado real em produção: vídeo maior que o
-- antigo limite do bucket posts-media, ver migration 0026). Mesmo padrão
-- de *_error já usado no resto do schema (caption_error, cutpro_error):
-- nunca falha em silêncio.
alter table public.drive_items
  add column mirror_error text;
