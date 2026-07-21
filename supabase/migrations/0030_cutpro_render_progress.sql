-- Quadro de renderização (progresso de edição Cut.Pro) — a API do Cut.Pro
-- já devolve um campo `progress` (0-100) na consulta de status de render
-- (GET /renders/{id}, ver lib/cutpro/client.ts getRenderStatus), hoje
-- descartado pelo pipeline. Coluna nova nas duas tabelas que passam pela
-- máquina de estados do Cut.Pro (mesmo padrão da migration 0028), pra
-- alimentar uma barra de progresso real em vez de só um rótulo estático.
-- Ver docs/superpowers/specs/2026-07-21-quadro-renderizacao-design.md.
--
-- ATENÇÃO: esta migration NÃO foi aplicada nesta sessão (MCP do Supabase
-- desconectado, sem psql/CLI configurado) — precisa ser rodada manualmente
-- no SQL Editor do projeto Supabase de produção (dtfnxurjemdabqukgqzc)
-- antes da % de progresso aparecer de verdade. Achado na revisão final de
-- branch: lib/drive/queries.ts (listDriveItems) e lib/cutpro/renderQueue.ts
-- usam select("*")/select explícito só de colunas já existentes — nenhuma
-- query nova quebra por causa desta coluna estar ausente; até a migration
-- rodar, cutpro_render_progress só vem undefined/null e o quadro de
-- renderização mostra tempo decorrido em vez de %, sem afetar o resto da
-- página.
alter table public.drive_items add column cutpro_render_progress integer;
alter table public.posts add column cutpro_render_progress integer;
