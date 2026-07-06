# M7 — Publicação via Zernio (design)

Contexto completo do produto em [docs/CLAUDE.md](../../CLAUDE.md) e milestones em [PLAN.md](../../../PLAN.md).

## Objetivo

Um post aprovado no painel é publicado automaticamente no horário agendado (ou assim que aprovado, se não houver horário) e o status atualiza para `publicado`, com link do post no ar. Publicação real só no Instagram por enquanto (demais redes ficam para depois, mesma decisão de "Instagram primeiro" do M6).

## Decisões de escopo

- **Sem documentação real da API do Zernio disponível ainda.** A implementação do cliente Zernio é um stub best-effort contra um formato REST razoável (API key + `POST /posts`), claramente isolado atrás de uma interface — ajustar contra a doc real do Zernio (quando o Victor tiver acesso) deve ser só uma troca de implementação, não um redesenho. Mesmo espírito do checklist manual do Supabase: código pronto, validação contra o provedor real fica para depois do desenvolvimento completo do app.
- **Post aprovado sem `scheduled_at` é publicado assim que possível** (próximo ciclo do cron), não bloqueado esperando agendamento. `scheduled_at` no passado ou nulo são tratados igual.
- **Falha de publicação nunca é silenciosa, mas não dispara e-mail ainda.** Grava `publish_error` visível no card do Kanban (mesmo padrão de `art_generation_error`/`notification_error`). Alerta ativo de conta desconectada (e-mail/monitoramento) fica para o M9, que já é o milestone dedicado a isso — evita duplicar escopo.
- **Sem retry automático após falha.** Uma vez que `publish_error` é gravado, o cron não tenta de novo sozinho (mesmo padrão de `art_generation_error` em `listPostsPendingArt`) — precisa da ação manual "Tentar publicar novamente", que limpa o erro e deixa o próximo ciclo do cron pegar o post de novo.
- **Vídeo fica fora do M7**, mesma decisão do M5 (`media_type = 'image'` só) — publicar vídeo levanta `PublishError` explícito em vez de tentar.

## Arquitetura

Camada de publicação isolada em `lib/publishing/` (decisão de arquitetura já registrada em `docs/CLAUDE.md`):

- `lib/publishing/types.ts`: interface `PublishingProvider` com um método `publish(input: PublishInput): Promise<PublishResult>`, e a classe de erro `PublishError` (mensagem legível, nunca lança um erro genérico não tratado).
- `lib/publishing/zernio.ts`: implementação stub do `PublishingProvider` para o Zernio — autentica com `ZERNIO_API_KEY` (já prevista em `.env.example` desde o M0), faz o POST assumido, mapeia a resposta para `{ postUrl }` ou lança `PublishError`.
- `lib/publishing/index.ts`: `getPublishingProvider(): PublishingProvider` — hoje sempre retorna a instância Zernio; trocar de agregador no futuro (Post Bridge, Postiz) é mudar só esta função.

## Modelo de dados (migration `0008_publishing.sql`)

- `posts.status`: adicionar `'publicado'` ao `check` existente (`pendente`, `rascunho`, `pendente_aprovacao`, `aprovado`, `rejeitado`, `publicado`).
- `posts`: novas colunas `published_at timestamptz`, `post_url text`, `publish_error text` (nullable, mesmo padrão de `art_generation_error`).
- `social_accounts`: nova coluna `zernio_account_id text` (nullable) — referência da conta no Zernio, necessária para saber em qual conta publicar. Editável só por admin em `/admin/contas` (mesma RLS `social_accounts_admin_write` já existente, sem mudança de policy).

## Fluxo de publicação

Novo cron `app/api/cron/publish-scheduled/route.ts`, mesmo padrão de autenticação (`isAuthorized` via `CRON_SECRET`, falha fechada) e de service client dos crons existentes (`generate-art`, `sla-alert`). Intervalo: `*/5 * * * *` (mesmo ritmo dos crons de IA/arte — publicação é sensível a horário agendado, diferente do SLA que tem janela de 4h).

Query de posts elegíveis (`lib/posts/pendingPublish.ts`, mesmo padrão de `pendingArt.ts`):
- `status = 'aprovado'`
- `rendered_art_url is not null` (a arte precisa existir — não publica sem a peça final do M5)
- `publish_error is null`
- `media_type = 'image'`
- (`scheduled_at is null` OR `scheduled_at <= now()`)

Para cada post elegível:
1. Busca `social_account` vinculada (precisa de `zernio_account_id` preenchido — se estiver nulo, grava `publish_error = "conta social sem zernio_account_id configurado"` e segue para o próximo post).
2. Chama `getPublishingProvider().publish({ postId, zernioAccountId, mediaUrl: rendered_art_url assinado, caption })`.
3. Sucesso: `update({ status: 'publicado', published_at: now(), post_url })`.
4. Falha (`PublishError` ou erro inesperado): `update({ publish_error: mensagem })`, status **não muda** (continua `aprovado`, permitindo nova tentativa manual).

## UI

- `components/kanban/post-card.tsx`: aviso âmbar de `publish_error`, mesmo padrão visual de `art_generation_error`/`notification_error`.
- Card de post `publicado` mostra link para `post_url` (abre em nova aba) e a data de `published_at`.
- Ação manual "Tentar publicar novamente" (visível só quando `publish_error` existe e o papel tem permissão de edição do post — mesmo `canEdit` já usado por `regenerateArt`) — limpa `publish_error`, deixando o post elegível de novo na query do cron.
- `/admin/contas`: campo novo "ID da conta no Zernio" no formulário existente (`social-account-form.tsx`), só admin.

## Tratamento de erros / casos de borda

- `zernio_account_id` não configurado: erro claro no card, nunca tenta publicar sem saber onde.
- Zernio indisponível (timeout, 5xx): `PublishError` com mensagem da resposta; sem retry automático (mesma political de `art_generation_error` — força triagem humana antes de gastar uma nova chamada).
- Post aprovado depois rejeitado/editado antes do cron rodar: a query já exclui (`status = 'aprovado'` deixa de bater assim que o status muda), sem necessidade de lógica extra de cancelamento.
- Post `publicado` que precisa ser corrigido: fora de escopo do M7 — não há fluxo de "despublicar"; qualquer erro pós-publicação em produção é tratado manualmente pelo Zernio hoje.

## Teste manual (fica registrado como checklist pendente, mesmo padrão dos milestones anteriores)

Não pode ser validado neste sandbox sem conta real no Zernio — mesma limitação de todos os milestones. Quando houver acesso:
1. Aprovar um post com `zernio_account_id` configurado e sem `scheduled_at` → publica no próximo ciclo do cron, status vira `publicado`, `post_url`/`published_at` preenchidos.
2. Aprovar um post com `scheduled_at` no futuro → confirmar que não publica antes da hora.
3. Aprovar um post numa conta sem `zernio_account_id` → `publish_error` visível, status continua `aprovado`.
4. Forçar uma falha do provedor (API key inválida) → `publish_error` visível, sem mudança de status; clicar "Tentar publicar novamente" → erro some e o cron tenta de novo.

## Fora de escopo (fica para milestones seguintes)

- Publicação em TikTok/YouTube/Facebook (M7 é só Instagram, mesma decisão do M6).
- Alerta ativo por e-mail/monitoramento de conta desconectada (M9).
- Métricas do post publicado (M9).
- Fila do acervo e agendamento distribuído (M8) — o M7 só publica o que já tem `scheduled_at`/aprovação manual, não decide horários.
