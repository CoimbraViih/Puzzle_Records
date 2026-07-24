# n8n: legenda pelo app, deduplicação real e mover pra Processados assíncrono — design

Data: 2026-07-24

## Contexto

Sessão de verificação da integração n8n ↔ painel (ver `docs/CLAUDE.md`, decisão de 21/07/2026) encontrou:

1. Os dois workflows n8n (`Puzzle Records — Drive → Instagram`, `Puzzle Records — Crons de publicação`) existem, batem com a arquitetura documentada, credenciais (Google Drive, OpenAI, OpenRouter, Supabase, Header Auth) estão cadastradas, e a conexão com o Supabase e com o deploy Vercel do painel foi testada e confirmada — mas **ambos os workflows estão `active: false`**, nada dispara sozinho ainda.
2. O nó "Somente não processados" (checagem de duplicado) consulta a Data Table interna do n8n `puzzle_posts`, que **parou de ser escrita** desde que o estado migrou pra `posts` no Supabase (T1, 21/07/2026) — hoje é uma checagem morta. Quem evita reprocessar hoje é só o vídeo sair fisicamente da pasta de origem cedo (nó "Mover vídeo p/ Processados (Drive)", logo após "Registrar: processando").
3. Victor quer mudar 2 coisas no fluxo: (a) a legenda/manchete passa a ser escrita pelo app, não pelo n8n; (b) o vídeo só deve ir pra pasta "Processados" depois de efetivamente publicado, não antes de editar.

Decisões tomadas durante o brainstorming (evitando reabrir dois problemas já resolvidos por decisões anteriores):
- Edição de vídeo continua 100% no n8n chamando a Cut.Pro direto — mover isso de volta pro app reabriria o teto de 50MB do Supabase Storage Free pro vídeo *original* (motivo original da decisão de 21/07).
- Publicação continua exclusiva de `lib/publishing/zernio.ts`, disparada por `publish-scheduled`/`daily-schedule` já existentes — **nenhuma rota nova de publicação**. Todo post aprovado (de qualquer `content_source`) já entra nessa fila e só publica quando `scheduled_at <= agora` (`lib/posts/pendingPublish.ts`) — reimplementar isso no n8n duplicaria idempotência/retry/analytics já validados com publicação real.

## Decisão

Mudança cirúrgica em 3 pontos, sem tocar em edição de vídeo nem em publicação:

1. **Legenda pelo app**: novo endpoint `POST /api/n8n/generate-caption`, que reaproveita `generateCopyVariations({ mode: "text", ... })` (`lib/openai/generateCopy.ts`) — o mesmo motor que já gera manchete/legenda pro resto do sistema, com o mesmo contrato de dados (`headline`, `caption`, `copy_variations`). O n8n troca o nó "Agente de Legendas" (LangChain + OpenRouter/GPT-4o, prompt duplicado do guia de estilo) por uma chamada HTTP a essa rota, usando título/descrição do clipe que a Cut.Pro já gerou como `fact`.
2. **Deduplicação real**: nó "Somente não processados" passa a checar `posts` no Supabase (via nova coluna `drive_file_id`) em vez da Data Table morta.
3. **Mover pra Processados vira assíncrono**: como a publicação pode demorar horas (espera `scheduled_at`), mover o arquivo não pode mais acontecer na mesma execução linear de edição. Vira um novo ramo agendado dentro do mesmo workflow n8n: a cada ciclo, busca em `posts` os itens `content_source = 'n8n'` com `status = 'publicado'` e `drive_moved_at is null`, move o arquivo no Drive e grava `drive_moved_at`.

## Mudanças

### 1. Dados (migration nova)

`posts` ganha duas colunas:
- `drive_file_id text` (nullable — só populado por posts vindos do n8n/Drive). Usada pela deduplicação (2) e pelo ramo de mover (3).
- `drive_moved_at timestamptz` (nullable). `null` = ainda não movido; usado como trava idempotente do ramo (3) — evita mover o mesmo arquivo duas vezes se o ramo rodar em ciclos sobrepostos.

Índice em `drive_file_id` (usado pela checagem de duplicado a cada ciclo de 10 min).

### 2. App: `POST /api/n8n/generate-caption`

- Auth: mesmo padrão `Authorization: Bearer $CRON_SECRET` das rotas `/api/cron/*` (reaproveita o secret existente, não cria um novo).
- Body: `{ postType: PostType; fact: string }` — `fact` é o título+descrição do clipe (Cut.Pro) concatenados, ou o nome do arquivo como fallback se ambos vierem vazios (mesma regra de "não inventar contexto" já usada no prompt original do n8n).
- Chama `generateCopyVariations({ mode: "text", postType, fact, trackName: null })` — `trackName: null` porque não há cadastro de artista (conta única, decisão de 10/07/2026).
- Resposta: `{ headline: string; caption: string; variations: CopyVariation[] }`.
- Erros do provedor de IA (`CopyGenerationError`) viram `400` com a mensagem — o n8n grava isso em `cutpro_error` do post (reaproveita a coluna existente, não cria uma nova de erro de legenda) e o post fica sem avançar pra aprovação, mesmo padrão de "nunca falha em silêncio" do resto do projeto.

### 3. Workflow n8n `Puzzle Records — Drive → Instagram` (`CY4247mhDrxvBgfi`)

- **Nó "Agente de Legendas" + "Saída estruturada" + "GPT-4o"/"OpenRouter Chat Model" (os 4 nós de IA) são removidos**, substituídos por um único nó HTTP Request chamando `/api/n8n/generate-caption` com o título/resumo do "Escolher melhor clipe". O nó "Registrar: pendente de aprovação" passa a ler `headline`/`caption`/`copy_variations` da resposta dessa chamada em vez de `$('Agente de Legendas').first().json.output`.
- **Nó "Registrar: processando"** ganha o campo `drive_file_id` no insert (hoje só codifica o id do Drive dentro de `media_url`).
- **Nó "Somente não processados"** troca de `dataTable`/`puzzle_posts` pra uma consulta Supabase (`n8n-nodes-base.supabase`, `operation: getAll` ou HTTP GET via PostgREST) filtrando `posts` por `drive_file_id = {{ id }}` — só segue pros próximos nós se não existir linha.
- **Novo ramo**: Schedule Trigger próprio (ex.: a cada 10 min, igual ao principal) → Supabase: buscar `posts` com `content_source = 'n8n' AND status = 'publicado' AND drive_moved_at IS NULL` → para cada um, `PATCH` no Drive (mesmo padrão do nó "Mover vídeo p/ Processados (Drive)" já existente, reaproveitando a lógica de `addParents`/`removeParents`) usando o `drive_file_id` gravado → Supabase: `update drive_moved_at = now()`. Erro de mover grava em `cutpro_error` (mesmo campo reaproveitado) sem travar o ciclo seguinte.
- **Nó "Mover vídeo p/ Processados (Drive)" existente** (o que roda logo após "Registrar: processando", hoje bem no início do fluxo) **é removido** — mover só acontece no novo ramo assíncrono, depois de publicado.

### 4. Ativação

Depois do código/workflow ajustados: ativar os dois workflows n8n (`CY4247mhDrxvBgfi` e `rKHuyk9Sgr0CMLch`) — hoje ambos `active: false`. Sem isso, nada do desenho acima roda de verdade, é só código parado.

## Fora de escopo (explícito)

- Reimplementar a chamada ao Zernio dentro do n8n (publicação continua exclusiva de `lib/publishing/zernio.ts`).
- Ativar aprovação via WhatsApp/Evolution (nós seguem desconectados, decisão de 22/07/2026 mantida).
- Compressão automática de vídeo grande (M19, decisão separada).
- Qualquer mudança em RLS, papéis ou na fila de aprovação existente no painel.
- Mudar `generateForPost`/`listPostsPendingCopy` (pipeline de copy do resto do sistema) — a nova rota é isolada, não altera o cron `generate-copy` existente.

## Testes

Sem suíte automatizada neste projeto (só `tsc --noEmit`/`eslint`/`next build`, confirmado em sessões anteriores) — verificação por esses três comandos + teste manual ponta a ponta com um vídeo real solto na pasta do Drive, observando: dedup não deixa reprocessar o mesmo arquivo em dois ciclos; legenda gravada em `posts.caption` bate com o que a rota `/api/n8n/generate-caption` retornou; arquivo só sai da pasta de origem depois que `status` vira `publicado`.

## Plano de execução (subagent-driven-development)

- **Tarefa 1 — Migration + endpoint do app**: migration `0032_posts_drive_dedup_columns.sql` (`drive_file_id`, `drive_moved_at`, índice); `app/api/n8n/generate-caption/route.ts` (auth `CRON_SECRET`, chama `generateCopyVariations`, trata `CopyGenerationError`). Verificação: `tsc --noEmit`, `eslint`, teste manual da rota com `curl` (mock de `fact`).
- **Tarefa 2 — Workflow n8n: legenda + deduplicação**: editar `CY4247mhDrxvBgfi` via MCP do n8n — remover os 4 nós de IA e religar pro novo HTTP Request; adicionar `drive_file_id` no insert de "Registrar: processando"; trocar "Somente não processados" pra consultar Supabase. Precisa dos IDs reais de node/credencial do workflow (já levantados nesta sessão) — usar `get_workflow_details`/`update_workflow` do MCP n8n, não recriar o workflow do zero.
- **Tarefa 3 — Workflow n8n: mover pra Processados assíncrono**: novo ramo (Schedule Trigger + Supabase query + Drive PATCH + Supabase update `drive_moved_at`) no mesmo workflow; remover o nó antigo "Mover vídeo p/ Processados (Drive)" do fluxo linear.
- **Tarefa 4 — Ativação e validação end-to-end**: ativar os dois workflows (`CY4247mhDrxvBgfi`, `rKHuyk9Sgr0CMLch`); rodar teste manual com vídeo real; conferir os três pontos da seção Testes.

**Pronto para avançar quando**: um vídeo solto no Drive gera um post em `posts` com legenda vinda da rota do app, não é reprocessado num segundo ciclo, e só sai da pasta de origem depois de `status = 'publicado'`.
