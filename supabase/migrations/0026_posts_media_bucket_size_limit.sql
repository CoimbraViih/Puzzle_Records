-- Corrige bug real achado em produção (19/07/2026, runtime error do Vercel):
-- "[drive-sync] falha ao subir mídia pro Storage: The object exceeded the
-- maximum allowed size" (413) -- o bucket posts-media tinha
-- file_size_limit=null (cai no teto global default do projeto, baixo
-- demais pra vídeo). Explica por que um vídeo maior enviado na pasta do
-- Drive nunca aparecia em /drive: mirrorFilePair (lib/drive/mirrorFile.ts)
-- captura esse erro por arquivo e segue pros próximos (não trava o sync
-- inteiro), mas o item que estourou o limite nunca é espelhado, sem
-- nenhum sinal visível pro usuário além do log de runtime da Vercel.
--
-- 500MB cobre com folga qualquer clipe de Reels/vídeo curto de divulgação
-- (Instagram já limita Reels a poucos minutos). Se o teto global do
-- projeto Supabase (Settings > Storage) for menor que isso, ainda vale
-- subir esse teto lá -- o limite efetivo é o menor dos dois.
update storage.buckets
set file_size_limit = 524288000 -- 500 MB
where id = 'posts-media';
