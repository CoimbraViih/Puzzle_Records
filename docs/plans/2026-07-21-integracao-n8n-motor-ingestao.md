# n8n como motor de ingestão/edição/legenda + publicação nativa (21/07/2026)

**Objetivo**: unir o workflow n8n "Puzzle Records — Drive → Instagram" (já construído e testado nesta sessão) com o painel Next.js existente (M16–M22), dividindo por onde cada um já é comprovadamente melhor, em vez de duplicar o mesmo pipeline em dois lugares. Resolve dois problemas reais: o teto de 50MB do Supabase Storage Free (que já travou tanto vídeo original quanto saída editada da Cut.Pro, M18–M21) e o cron do GitHub Actions throttlado (~1–3h em vez de 5min, M18/M20).

## Contexto (decisões já tomadas nesta sessão)

- O painel Next.js já implementa nativamente Drive→Cut.Pro→IA→aprovação→Zernio (M16–M22), publicado de verdade duas vezes (`instagram.com/reel/Da_0rblicBe/`). Mas passa o vídeo original pelo Supabase Storage antes de editar, e esse teto de 50MB já travou tanto o original quanto a saída editada em testes reais.
- O workflow n8n (`CY4247mhDrxvBgfi`) já resolve a entrada: "Baixar vídeo do Drive" → "Cut.Pro: enviar bytes" vai direto, sem passar pelo Storage. Tem também um Agente de Legendas mais refinado (guia de estilo, duas estruturas de legenda, `outputParserStructured` com `autoFix`).
- Mas hoje o n8n escreve estado numa Data Table própria (`puzzle_posts`), invisível pro painel — e a aprovação humana está desconectada: os nós "Aprovado?" e "WhatsApp: pedir aprovação (Evolution)" não têm nenhuma conexão de entrada. Rodar o workflow como está publicaria no Instagram sem gate nenhum (confirmado inspecionando as conexões reais do workflow, execução 32 desta sessão).
- **Decisão**: n8n cuida de ingestão + edição (Cut.Pro) + legenda; o painel cuida da aprovação humana (já pronto, mais capaz que reconectar WhatsApp do zero — Evolution API nunca foi configurada de verdade, só valores de exemplo); a publicação real continua no código nativo (`lib/publishing/zernio.ts` — trava de idempotência, teto de 10 tentativas, alimenta analytics e horários estratégicos do calendário), só que chamado com confiabilidade pelo relógio do n8n em vez do GitHub Actions.
- **Capacidade validada com arquivo real (22/07/2026)**: Victor soltou um vídeo de 133,8MB ("PLANO DE LANÇAR LINHA K-BEAUTY NA COREIA.mp4") na pasta sincronizada. Teste seguro (execuções 32–34: desconectar "Baixar vídeo do Drive" → "Cut.Pro: enviar bytes", apontar o download direto pro arquivo, rodar, medir, reconectar) confirmou download bem-sucedido em ~4s, sem erro nem timeout. O n8n self-hosted aguenta vídeo real acima de 100MB sem ajuste adicional — T4 fechada.
- **Decisão (22/07/2026): os nós "Aprovado?" e "WhatsApp: pedir aprovação (Evolution)" ficam no canvas, desconectados, sem alteração** — Victor pretende usá-los depois. Não fazem parte do fluxo de aprovação desta integração (que continua sendo só o painel); T2 (remover) foi cancelada.

## Tarefas

- [ ] **T1 — Migrar escrita de estado: `puzzle_posts` (Data Table do n8n) → `posts` (Supabase)**. Trocar os nós "Registrar: processando"/"Registrar: publicado"/"Registrar: rejeitado"/"Registrar erro (clipagem/render)" — hoje `n8n-nodes-base.dataTable` apontando pra `puzzle_posts` — por chamadas HTTP à API REST do Supabase (PostgREST) com a service role key, escrevendo nas colunas que a migration `0028_posts_cutpro_columns.sql` já criou em `posts` (`edit_status`, `cutpro_video_id/submission_id/clip_id/template_id/render_id`, `cutpro_error`, `edited_media_path`). Reaproveitar exatamente os mesmos nomes/valores que `lib/cutpro/pipeline.ts` já usa, pra a UI existente (`RenderStatusBadge`, `EDIT_STATUS_LABEL`, `isCutProBusy`) funcionar sem nenhuma alteração. Ao final do Agente de Legendas, gravar `caption` + `status: 'pendente_aprovacao'`.
  - **Decisão pendente de confirmar com o Victor**: a saída editada (vídeo) ainda precisa de algum pouso pro painel conseguir mostrar preview e o Zernio nativo conseguir publicar — n8n baixa o render da Cut.Pro e sobe pro bucket `posts-media` (mesmo path `cutpro-edited/{id}.mp4`, alimentando `rendered_art_url`). Isso reabre o teto de 50MB especificamente pra saída editada (já visto no M21) — sem solução automática de compressão ainda (isso é o M19, não decidido). Tratamento: erro explícito em `cutpro_error`, nunca falha em silêncio, mesmo padrão do resto do projeto.

- [x] ~~T2 — Remover a aprovação morta do n8n~~ **Cancelada (22/07/2026)**. Decisão do Victor: os nós "Aprovado?", "WhatsApp: pedir aprovação (Evolution)" e "Aguardar aprovação (WhatsApp)" ficam no canvas, desconectados, sem alteração — serão usados depois (uso futuro ainda não definido). Enquanto isso, eles permanecem inertes: nada os alimenta, então não interferem no fluxo real. O gate de aprovação desta integração continua sendo exclusivamente o painel (`/aprovação`).

- [ ] **T3 — n8n como relógio dos crons de publicação**. Adicionar Schedule Trigger(s) chamando `GET {SITE_URL}/api/cron/publish-scheduled` (5 min) e `GET {SITE_URL}/api/cron/daily-schedule` (30 min) com header `Authorization: Bearer $CRON_SECRET` — substitui, só pra essas duas rotas, o `.github/workflows/cron-trigger.yml` throttlado. As demais rotas (`generate-copy`, `generate-art`, `collect-metrics` etc.) continuam via GitHub Actions, fora do escopo deste plano. Desativar o disparo dessas 2 rotas específicas no GitHub Actions pra evitar chamada duplicada.

- [x] **T4 — Validar capacidade real do n8n pra vídeo 100MB+**. Feito em 22/07/2026 com arquivo real de 133,8MB — download em ~4s, sucesso, sem erro. Nenhum ajuste de `N8N_DEFAULT_BINARY_DATA_MODE`/`N8N_PAYLOAD_SIZE_MAX` foi necessário.

- [ ] **T5 — Teste ponta a ponta com aprovação real no painel**. Com 1 vídeo real: Drive → n8n (edição + legenda) → aparece em `pendente_aprovacao` no painel (`/aprovação`) → aprovar pelo painel → conferir que `publish-scheduled`/`daily-schedule` (agora chamados pelo relógio do n8n) publicam de verdade via Zernio. Conferir também que `collect-metrics` (analytics) continua funcionando — fecha o ciclo completo sem nenhuma lacuna.

## Fora de escopo (explícito)

Reimplementar a chamada ao Zernio dentro do n8n (fica no código nativo, mais maduro); ativar a aprovação via WhatsApp/Evolution API nesta integração (os nós ficam no canvas, desconectados, reservados pra um uso futuro ainda não definido — ver T2); compressão automática de vídeo grande (M19, decisão separada); qualquer alteração na fila de aprovação, RLS ou papéis já existentes no painel.

## Status (22/07/2026)

Fechadas: T2 (cancelada por decisão do Victor — nós de aprovação do WhatsApp ficam intocados pra uso futuro) e T4 (capacidade validada com vídeo real de 133,8MB, sucesso). Pendentes: T1 (migrar escrita `puzzle_posts` → `posts`), T3 (n8n como relógio) e T5 (teste ponta a ponta com aprovação real no painel).

## Pronto para avançar quando

T1, T3 e T5 fechadas — com um vídeo real acima de 100MB passando ponta a ponta: sincronizado, editado pela Cut.Pro via n8n, aparecendo em `pendente_aprovacao` no painel, aprovado por lá, e publicado de verdade via Zernio nativo (chamado pelo relógio do n8n) — sem nenhum vídeo passando pelo Supabase Storage antes da edição, e sem depender do GitHub Actions pra publicação. T4 já fechada; T2 cancelada (nós do WhatsApp preservados pra uso futuro).
