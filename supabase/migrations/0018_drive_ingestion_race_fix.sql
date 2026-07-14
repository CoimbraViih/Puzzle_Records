-- Achado da revisão de bugs de 13/07/2026 (pré-conexão real do Google
-- Drive, ver PLAN.md M11): ingestFilePair() (lib/drive/ingestFile.ts)
-- checa "já processado" com um select simples antes de fazer todo o
-- trabalho caro (download, upload, insert do post) e só registra
-- status='processado' em drive_ingestions no final — sem nenhuma trava
-- atômica, diferente do padrão de claim já usado em publish-scheduled/
-- poll-video-render/acervo-schedule. Duas execuções sobrepostas do cron
-- de ingestão (ex.: uma anterior ainda processando um vídeo grande quando
-- o próximo ciclo de 5min dispara) poderiam passar as duas pelo mesmo
-- check e criar 2 posts duplicados pro mesmo arquivo do Drive.
--
-- Índice único parcial: só sobre status='processado' (não bloqueia o
-- reprocessamento de um arquivo que falhou antes com status='erro' --
-- comportamento intencional já existente). A segunda tentativa de
-- inserir 'processado' pro mesmo drive_file_id agora falha com unique
-- violation (23505) -- lib/drive/ingestFile.ts trata esse código como
-- "outra execução já processou esse arquivo" e desfaz o post/mídia
-- duplicados que essa execução tinha acabado de criar, em vez de deixar
-- os dois.
create unique index if not exists drive_ingestions_file_id_processed_idx
  on public.drive_ingestions (drive_file_id)
  where status = 'processado';
