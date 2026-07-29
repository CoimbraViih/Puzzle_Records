Preciso de um conjunto de correções da auditoria de produto de 29/07 (contexto completo em docs/2026-07-29-auditoria-produto.md, mas resumo tudo que precisa aqui). São mudanças pequenas e majoritariamente independentes entre si — pode fazer uma de cada vez.

## Fase 0 — risco alto, esforço mínimo

1. **maxDuration em 3 crons**: `app/api/cron/publish-scheduled/route.ts`, `app/api/cron/cutpro-pipeline/route.ts`, `app/api/cron/drive-sync/route.ts` — adicionar `export const maxDuration = 300;` no topo de cada um (mesmo padrão já usado em `generate-copy`/`generate-video-art`). Motivo: sem isso, a função é interrompida no meio de uma chamada externa lenta (polling do Zernio de até 30s, upload pro Cut.Pro, download de vídeo grande do Drive) sem gravar nenhum erro — o post fica travado sem rastro. O caso mais grave é `publish-scheduled`: como `zernio_post_id` já é gravado antes do polling, um post pode estar publicado de verdade no Instagram enquanto o painel mostra "Publicando..." como se tivesse falhado.

2. **`lib/posts/pendingCopy.ts`** — a query que lista posts pendentes de legenda não filtra `content_source`. Adicionar `.neq("content_source", "n8n")`, mesmo padrão já aplicado em `app/api/cron/cutpro-pipeline/route.ts` (`fetchEligibleItems`) nesta mesma semana. Motivo: evita que este cron gere legenda nativa por cima de um post que o workflow n8n ainda vai legendar sozinho.

3. **`npm audit fix`** — atualiza `next` (16.2.10 → 16.2.12, corrige CVEs high de SSRF em Server Actions/rewrites e bypass de middleware com Turbopack) e as dependências transitivas (`postcss`, `sharp`, `brace-expansion`). Se `npm audit fix` sozinho não resolver o Next, força `npm install next@16.2.12` direto. Roda o build depois pra confirmar que nada quebrou.

*(Dois itens da Fase 0 já apliquei eu mesmo direto no n8n, não precisam de código aqui: o nó de erro faltando na geração de legenda do workflow "Drive → Instagram", já corrigido e publicado. O toggle "Leaked Password Protection" no Supabase Auth continua pendente — é manual, no dashboard do Supabase, não mexe nisso.)*

## Fase 1 — fecha os "trava sem avisar" na UX

4. **Badge de `video_render_status`** — `components/kanban/post-card.tsx` e `components/drive/drive-item-card.tsx`. Hoje `video_render_status` (`processing`/`done`/`error`) só é lido/escrito em `app/api/cron/generate-video-art/route.ts` e `app/api/cron/poll-video-render/route.ts`, nunca aparece na UI — um post pode ficar horas "processing" sem nenhuma indicação visual, idêntico a um post que nem começou. Adicionar um badge simples reaproveitando o padrão visual do `RenderStatusBadge` já usado pro Cut.Pro, mostrando algo como "Gerando arte..." quando `video_render_status === "processing"`.

5. **`lib/calendar/actions.ts`** (`updateDailyPostSlots`) **+ `components/calendar/daily-slots-panel.tsx`** — hoje um horário mal formatado (ex: `9:00` em vez de `09:00`) é filtrado em silêncio pela regex `/^\d{2}:\d{2}$/` e some da lista salva sem nenhum aviso — isso reduz a fila automática de publicação sem o usuário perceber. Trocar por validação explícita no formulário (client-side, antes de submeter) com mensagem de erro clara pra qualquer horário fora do formato, em vez de descartar em silêncio no server action.

6. **`components/admin/contas-panel.tsx` + `components/admin/contas-actions.ts`** — os 3 botões desta tela (adicionar conta via Zernio, salvar `zernio_account_id`, excluir conta) usam `<form action={...}>` puro sem `useActionState`/`useTransition`, e os erros só vão pra `console.error` — a tela volta ao normal como se tivesse dado certo mesmo quando falha. Replicar o padrão já usado nos posts (`SubmitButton`/`ConfirmSubmitButton`): loading visível + mensagem de erro na tela.

7. **`lib/posts/pendingVideoArt.ts`** (`listPostsPendingVideoArt`) — a query não filtra `edit_status`, então um post que o usuário mandou manualmente pro fluxo Cut.Pro (`edit_status` em `enviando`/`clipando`/`renderizando`) pode ser pego em paralelo pelo pipeline Remotion nativo, duas máquinas de estado de vídeo competindo pela mesma linha. Excluir posts com `edit_status` em transição dessa query.

8. **`app/api/cron/cutpro-pipeline/route.ts`** (`fetchEligibleItems`/`advanceCutProEdit`) — duas execuções sobrepostas do cron podem pegar o mesmo item "enviando" e processar em paralelo, pagando Cut.Pro duas vezes pelo mesmo vídeo. Adicionar um claim atômico antes de processar cada item (update condicionado ao `edit_status` esperado, checando se a atualização realmente afetou a linha antes de prosseguir) — mesmo padrão já usado em `app/api/cron/poll-video-render/route.ts` e `app/api/cron/daily-schedule/route.ts`, é só replicar aqui.

## Sentry — instrumentar de verdade

Já conectamos o Sentry como MCP nesta sessão (dá pra consultar issues via chat), mas o app ainda não reporta nada pra lá de verdade — os erros continuam só em `console.error` ou em silêncio total, que foi o padrão que mais apareceu na auditoria.

9. Instalar `@sentry/nextjs` e criar a instrumentação **server-side** (`instrumentation.ts` + `sentry.server.config.ts`, seguindo a doc oficial do Sentry pra Next.js App Router). Não precisa rodar o wizard interativo — pode criar os arquivos manualmente. Usar `process.env.SENTRY_DSN` (adiciona ao `.env.example` comentado; eu preencho o valor real em `.env.local` depois de pegar no dashboard do Sentry). Não precisa de client-side/source maps por enquanto — o ganho imediato é capturar os erros de servidor.

10. Adicionar `Sentry.captureException(err)` (de `@sentry/nextjs`) nos catch blocks das 9 rotas de cron em `app/api/cron/*/route.ts` que hoje só fazem `console.error`, e nos 3 pontos que a auditoria de UX flagrou como "erro engolido": `lib/calendar/actions.ts`, `components/admin/contas-actions.ts`, e a action de duplicar template (`components/templates/template-card.tsx` ou o arquivo de actions correspondente). Não muda o comportamento de cada um — continuam gravando erro no banco/console como já fazem — só adiciona a captura extra pro Sentry.

## Depois de tudo

Roda `tsc`, `lint` e `build`. Documenta no PLAN.md (uma entrada por fase, ou uma milestone só cobrindo tudo — o que fizer mais sentido no histórico). Fase 2 da auditoria (testes automatizados) fica de fora deste prompt de propósito, é assunto pra outra sessão.
