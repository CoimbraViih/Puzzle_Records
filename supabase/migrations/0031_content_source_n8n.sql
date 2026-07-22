-- n8n como motor de ingestão/edição/legenda (decisão de 21/07/2026, ver
-- docs/CLAUDE.md e PLAN.md). O workflow n8n "Puzzle Records — Drive →
-- Instagram" passa a escrever estado direto em `posts` via PostgREST
-- (service role), migrando de `puzzle_posts` (Data Table interna do n8n,
-- invisível pro painel). `content_source` já distinguia 'drive' (ingestão
-- nativa do painel) e 'painel'/'acervo' -- adiciona 'n8n' pra manter essa
-- distinção operacional (dashboard/troubleshooting), já que agora dois
-- caminhos diferentes podem originar um post vindo da mesma pasta do Drive.
alter table public.posts drop constraint if exists posts_content_source_check;
alter table public.posts
  add constraint posts_content_source_check
  check (content_source in ('drive', 'acervo', 'painel', 'n8n'));
