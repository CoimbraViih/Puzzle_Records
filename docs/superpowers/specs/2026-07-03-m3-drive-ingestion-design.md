# M3 — Ingestão do Google Drive (design)

Contexto completo do produto em [docs/CLAUDE.md](../../CLAUDE.md) e milestones em [PLAN.md](../../../PLAN.md).

## Objetivo

Conteúdo entra no sistema sem intervenção manual: a equipe solta mídia + fato numa pasta do Google Drive e o sistema cria um post pendente no painel em poucos minutos, sem manchete/legenda ainda (isso é o M4).

## Decisões de escopo

- M3 é pré-requisito do M4: a fila de aprovação (M2) hoje só aceita posts criados manualmente com `headline`/`caption`/`social_account_id`/`template` preenchidos. M3 precisa relaxar esse schema para aceitar posts "esqueleto".
- Metadados (artista, música, fato, conta social, tipo de post) vêm num arquivo `.json` com o mesmo nome-base da mídia (ex.: `video1.mp4` + `video1.json`).
- Quando artista ou conta social do JSON não batem com nenhum registro cadastrado, o post é criado mesmo assim (sem vínculo) com um aviso visível na fila — nunca falha em silêncio, e nunca descarta o arquivo.
- Template (A/B) fica em branco no M3; é decidido depois (M5 ou edição manual na fila).
- Autenticação com o Drive via Service Account do Google Cloud (pasta compartilhada como "Editor" com o e-mail da service account) — não depende de login/token pessoal do Victor.
- Polling via Vercel Cron a cada 5 minutos.
- Após processar com sucesso, os arquivos originais (mídia + json) são movidos para uma subpasta `Processados/` na mesma pasta do Drive — mantém auditoria visual e evita reprocessamento mesmo em caso de falha no banco de dedupe.

## Arquitetura

- Rota `app/api/cron/drive-ingest/route.ts`, chamada pelo Vercel Cron (`vercel.json` → `crons`), protegida pelo mesmo padrão de secret de outras crons do projeto.
- Lógica de acesso ao Drive isolada em `lib/drive/` (client, listagem, download, move) — mesmo padrão de camada isolada usado para o Zernio (ver `docs/CLAUDE.md`).
- Biblioteca `googleapis` (cliente oficial Node) para listar, baixar e mover arquivos.
- Variáveis de ambiente novas: `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` (JSON da service account) e `GOOGLE_DRIVE_FOLDER_ID` (pasta raiz monitorada) — já previstas em `.env.example` desde o M0.

## Fluxo por execução do cron

1. `lib/drive/client.ts` autentica com a service account.
2. `lib/drive/listPendingFiles.ts` lista arquivos na pasta raiz que não estão em `Processados/` e cujo `drive_file_id` ainda não existe em `drive_ingestions`.
3. `lib/drive/pairFiles.ts` agrupa arquivos por nome-base (mídia + json). Pares incompletos (só um dos dois presente) são ignorados nesta execução — processados quando o par completar.
4. Para cada par completo:
   a. Baixa e faz `JSON.parse` do metadado. Erro de parse → grava `drive_ingestions` como `erro` com a mensagem, não cria post, não move os arquivos (ficam na pasta para a equipe corrigir e ficam elegíveis a nova tentativa, já que não foram marcados como processados).
   b. Baixa a mídia e sobe para o bucket `posts-media` do Supabase Storage.
   c. Resolve `artist_id` (match por `name`/`handle`) e `social_account_id` (match por `handle`) a partir do texto do JSON. Sem match → campo fica `null` e `ingestion_warning` é preenchido com uma mensagem legível (ex.: `"artista não encontrado: MC Fulano"`).
   d. Insere o post: `status = 'pendente'`, `post_type`/`source_fact`/`track_name` do JSON, `template = null`, `headline = null`, `caption = null`, `media_url`/`media_type` da mídia enviada.
   e. Marca a linha correspondente em `drive_ingestions` como `processado` e move os 2 arquivos originais para `Processados/` no Drive.

## Modelo de dados (migration `0003_drive_ingestion.sql`)

- `posts.status`: adicionar `'pendente'` ao `check` existente (`rascunho`, `pendente_aprovacao`, `aprovado`, `rejeitado`, `pendente`).
- `posts.social_account_id`, `posts.template`, `posts.headline`, `posts.caption`, `posts.created_by`: tornar `nullable` (hoje `NOT NULL`) — um post ingerido pelo Drive não tem autor humano nem esses campos definidos ainda. `post_type` continua `NOT NULL` (vem do JSON no momento da criação).
- Novo campo `posts.ingestion_warning text` (nullable) — mensagem de aviso quando artista/conta social do M3 não batem com nenhum registro.
- Novos campos `posts.source_fact text` e `posts.track_name text` (nullable) — guardam o "fato" e a "música" do JSON de metadado. Sem esses campos o M4 não teria a partir de quê gerar a manchete/legenda; `source_fact` é a matéria-prima que a OpenAI vai usar, `track_name` é a música a taggear no post de lançamento (regra do guia de estilo).
- Nova tabela `drive_ingestions`: `id uuid pk`, `drive_file_id text unique not null`, `post_id uuid references posts(id)` (nullable — fica null em caso de erro antes de criar o post), `status text check (status in ('processado','erro'))`, `error_message text`, `created_at timestamptz default now()`.
- RLS em `drive_ingestions`: leitura restrita a admin (log técnico, não precisa aparecer para outros papéis); sem policy de insert/update para usuários — só o service role (usado pela rota de cron) escreve.

## Tratamento de erros / casos de borda

- Falha ao mover os arquivos após criar o post com sucesso: não é crítico (o post já existe); loga o erro mas não tenta recriar o post — dedupe já é garantido por `drive_file_id` em `drive_ingestions`.
- Falha na API do Drive (rate limit, indisponibilidade momentânea): a execução do cron simplesmente não processa nada nessa rodada; tenta de novo em 5 minutos. Não dispara alerta — é atraso, não perda de post.
- Falha ao subir a mídia para o Storage: não cria o post, não marca como processado em `drive_ingestions`, não move os arquivos — fica elegível para nova tentativa na próxima execução.
- JSON malformado: ver passo 4a acima — fica registrado como erro, arquivo permanece na pasta original para correção manual.

## Teste manual (critério de pronto do milestone)

- Soltar um par mídia+json válido na pasta → post aparece com status "pendente" no Kanban em até 5 minutos; os 2 arquivos originais aparecem movidos para `Processados/`.
- Soltar só a mídia (sem json) → nada é criado; ao soltar o json depois, o par é processado normalmente na próxima execução do cron.
- JSON referenciando artista ou conta social inexistentes → post é criado com `ingestion_warning` visível na UI da fila.
- Forçar reprocessamento manual de um `drive_file_id` já presente em `drive_ingestions` → não deve duplicar o post.

## Fora de escopo (fica para milestones seguintes)

- Geração de manchete/legenda via OpenAI (M4).
- Escolha/renderização de template de arte (M5).
- Qualquer alerta por e-mail sobre ingestão (fica para M9, junto com os demais alertas de conexão).
