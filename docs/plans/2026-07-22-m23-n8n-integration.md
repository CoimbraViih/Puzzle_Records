# M23 — n8n como motor de ingestão/edição/legenda Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fazer o workflow n8n "Puzzle Records — Drive → Instagram" (`CY4247mhDrxvBgfi`) escrever estado direto na tabela `posts` do Supabase (em vez da Data Table `puzzle_posts`), parar de publicar direto via Zernio dentro do n8n, e assumir o relógio dos dois crons de publicação — fechando o ciclo Drive → n8n (edição+legenda) → fila de aprovação do painel → Zernio nativo → analytics.

**Architecture:** O n8n continua fazendo ingestão (Drive) + edição (Cut.Pro) + legenda (Agente de IA). Ao final da legenda, ele grava um post em `pendente_aprovacao` direto em `posts` via PostgREST (service role) e **para** — não publica mais nada sozinho. A aprovação humana e a publicação real (Zernio) continuam 100% no painel Next.js, só que agora dois Schedule Triggers no n8n chamam `/api/cron/publish-scheduled` e `/api/cron/daily-schedule` com confiabilidade (em vez do GitHub Actions throttlado), e o `cron-trigger.yml` para de duplicar essas duas chamadas.

**Tech Stack:** n8n (workflow `CY4247mhDrxvBgfi`, self-hosted), Supabase Postgres (PostgREST REST API, service role key), Next.js API routes (`/api/cron/*`), GitHub Actions (`.github/workflows/cron-trigger.yml`).

---

## Achado crítico (ler antes de tocar no workflow)

Inspecionei o workflow ao vivo via MCP do n8n (`get_workflow_details`). A cadeia `Agente de Legendas` → `Zernio: listar contas` → `Zernio: presign` → `Baixar p/ publicar` → `Zernio: enviar vídeo` → `Zernio: publicar no Instagram` → `Aguardar publicação (30s)` → `Zernio: status do post` → `Post no ar?` → `Registrar: publicado` **está conectada e ativa no fluxo principal** — não é um branch morto. Os nós `Aprovado?` e `WhatsApp: pedir aprovação (Evolution)` (que deveriam ser o gate) não têm nenhuma conexão de entrada, confirmando o que `docs/CLAUDE.md` já registrava. Ou seja: hoje, se esse workflow for ativado, ele publica no Instagram via Zernio **sem nenhuma aprovação humana** — quebra direta da regra de ouro do projeto.

A Task 1 abaixo não é só trocar `dataTable` por HTTP Request — ela precisa **desconectar** a cadeia de publicação Zernio do n8n (fica desconectada no canvas, igual aos nós de WhatsApp — não precisa deletar, só parar de alimentar) e religar `Agente de Legendas` direto no novo nó de gravação em `posts` com `status: 'pendente_aprovacao'`.

---

## Pré-requisito: aplicar migration 0031 em produção

A migration `0031_content_source_n8n.sql` já existe no repo (`supabase/migrations/0031_content_source_n8n.sql`) mas ainda não foi aplicada em produção (mesma pendência manual do M22). Sem ela, qualquer insert do n8n com `content_source: 'n8n'` vai falhar na constraint `posts_content_source_check`.

**Passo 1:** Aplicar via `npx supabase db push` ou colando o SQL no SQL Editor do projeto de produção (`dtfnxurjemdabqukgqzc`).

**Passo 2:** Confirmar rodando no SQL Editor:
```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname = 'posts_content_source_check';
```
Expected: a definição inclui `'n8n'` na lista de valores aceitos.

**Passo 3:** Marcar em `PLAN.md` a linha da migration 0031 como aplicada (mesmo padrão usado para a 0030 no M22).

---

### Task 1: Migrar escrita de estado do n8n (`puzzle_posts` → `posts` via PostgREST) e desconectar o path de publicação Zernio

**Contexto de colunas (já existem em produção, migration `0028_posts_cutpro_columns.sql`):**
`edit_status` (`nao_editado`|`enviando`|`clipando`|`aplicando`|`renderizando`|`editado`|`erro`), `cutpro_video_id`, `cutpro_submission_id`, `cutpro_clip_id`, `cutpro_template_id`, `cutpro_render_id`, `cutpro_error`, `edited_media_path`. Além disso a tabela `posts` já tem `caption`, `status`, `content_source`, `rendered_art_url`, `created_by` (FK not null), `social_account_id` (FK not null).

**Ferramentas:** MCP `claude_ai_n8n`. Antes de escrever qualquer parâmetro de nó, chamar `get_sdk_reference` e `get_workflow_best_practices` (technique relevante: HTTP Request / PostgREST se existir na lista, senão `list`) — não adivinhar sintaxe.

**Step 1: Levantar os IDs fixos (admin e conta única)**

Via `list_credentials`/consulta REST direta (mesma técnica já usada na sessão de 21/07 para achar esses IDs):
```
GET {SUPABASE_URL}/rest/v1/profiles?role=eq.admin&select=id
GET {SUPABASE_URL}/rest/v1/social_accounts?select=id&limit=1
```
Header: `apikey: {SUPABASE_SERVICE_ROLE_KEY}` + `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`.
Anote os dois UUIDs — vão ser valores fixos (não expressões) nos nós HTTP Request abaixo.

**Step 2: Criar credencial HTTP genérica no n8n para o Supabase**

Tipo `Header Auth` (ou `Generic Credential Type` com dois headers): `apikey` e `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Confirmar com `list_credentials` que não existe já uma antes de criar.

**Step 3: Substituir "Registrar: processando" (`n8n-nodes-base.dataTable`) por HTTP Request → `POST {SUPABASE_URL}/rest/v1/posts`**

Body (JSON):
```json
{
  "created_by": "<uuid do admin>",
  "social_account_id": "<uuid da conta única>",
  "content_source": "n8n",
  "type": "video",
  "status": "processando",
  "edit_status": "enviando",
  "cutpro_video_id": null
}
```
Header adicional: `Prefer: return=representation` (precisa do `id` gerado de volta para os nós seguintes referenciarem via `$('Registrar: processando').first().json.id`).

Isso substitui a referência que hoje os nós de erro/registro usam (`drive_file_id` como chave de correlação) — a partir daqui, a correlação passa a ser o `id` (uuid) retornado por este insert, não mais o `drive_file_id` do Drive. Qualquer nó que hoje resolve `$('Selecionar 1 vídeo').first().json.id` para achar a linha (`Registrar: publicado`, `Registrar: rejeitado`, `Registrar erro (clipagem)`, `Registrar erro (render)`) precisa trocar para `$('Registrar: processando').first().json[0].id` (uuid do post) em um `PATCH {SUPABASE_URL}/rest/v1/posts?id=eq.{{ uuid }}`.

**Step 4: Substituir "Registrar erro (clipagem)" e "Registrar erro (render)"**

`PATCH {SUPABASE_URL}/rest/v1/posts?id=eq.{{ $('Registrar: processando').first().json[0].id }}`
Body: `{"edit_status": "erro", "cutpro_error": "Clipagem falhou na Cut.Pro"}` (ou "Render falhou na Cut.Pro" no segundo nó).

**Step 5: Desconectar a cadeia de publicação Zernio e religar `Agente de Legendas`**

No editor do n8n: remover a conexão `Agente de Legendas → Zernio: listar contas`. Os nós `Zernio: presign`, `Baixar p/ publicar`, `Zernio: enviar vídeo`, `Zernio: publicar no Instagram`, `Aguardar publicação (30s)`, `Zernio: status do post`, `Post no ar?`, `Registrar: publicado` ficam no canvas desconectados (mesmo tratamento dado aos nós de WhatsApp no T2) — não deletar, só desligar do fluxo principal, documentando com uma sticky note por quê (referenciar este plano/PLAN.md).

Criar um novo nó HTTP Request, **"Registrar: pendente de aprovação"**, conectado direto na saída de `Agente de Legendas`:
`PATCH {SUPABASE_URL}/rest/v1/posts?id=eq.{{ $('Registrar: processando').first().json[0].id }}`
Body:
```json
{
  "caption": "={{ $json.output.legenda }}",
  "status": "pendente_aprovacao",
  "edit_status": "editado",
  "edited_media_path": "cutpro-edited/{{ $('Registrar: processando').first().json[0].id }}.mp4"
}
```

**Step 6: Upload da saída editada pro bucket `posts-media`**

Antes do Step 5 (ou em paralelo), adicionar um nó de upload do binário de `Baixar vídeo editado` para o Supabase Storage:
`POST {SUPABASE_URL}/storage/v1/object/posts-media/cutpro-edited/{{ $('Registrar: processando').first().json[0].id }}.mp4`
Header: `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`, `Content-Type: video/mp4`, body = binário do vídeo editado (`inputDataFieldName` apontando pro binary da Cut.Pro).
Path deve bater exatamente com o `edited_media_path` gravado no Step 5, pra UI existente (`RenderStatusBadge`) mostrar o preview sem alteração de código no painel. **Atenção:** isso reabre o teto de 50MB do Storage Free para a saída editada — se o arquivo estourar, gravar erro explícito em `cutpro_error` em vez de falhar em silêncio (mesmo padrão do resto do projeto); não implementar compressão automática aqui (M19, fora de escopo).

**Step 7: Validar o workflow**

Rodar `validate_workflow` (MCP) sobre o workflow atualizado antes de publicar. Corrigir qualquer erro de referência de nó apontado.

**Step 8: Publicar a nova versão**

`publish_workflow` (MCP), **sem ativar** o Schedule Trigger ainda (isso é a Task 3) — publicar só a versão corrigida do workflow pra manter histórico de versão (`get_workflow_history` deve mostrar a revisão).

**Step 9: Atualizar `PLAN.md`**

Marcar T1 como concluída, com a nota de que a cadeia Zernio interna foi desconectada (achado desta sessão, não estava no escopo original documentado do T1).

```bash
git add PLAN.md
git commit -m "docs: fecha T1 do M23 (migração de estado + desconexão do Zernio interno no n8n)"
git push origin main
```

---

### Task 2 (T3): n8n como relógio dos crons de publicação

**Files:**
- Modify: `.github/workflows/cron-trigger.yml`

**Step 1: Criar os dois Schedule Triggers no n8n**

No workflow `CY4247mhDrxvBgfi` (ou um workflow novo dedicado só a isso, se preferir isolar do fluxo de ingestão — decisão livre, mas mais simples manter os dois crons num workflow separado "Puzzle Records — Crons de publicação" pra não acoplar ao ciclo de 10min de ingestão de vídeo):
- Schedule Trigger A: intervalo 5 minutos → HTTP Request `GET {SITE_URL}/api/cron/publish-scheduled`, header `Authorization: Bearer {CRON_SECRET}`.
- Schedule Trigger B: intervalo 30 minutos → HTTP Request `GET {SITE_URL}/api/cron/daily-schedule`, header `Authorization: Bearer {CRON_SECRET}`.

Usar a mesma credencial de Header Auth do Task 1 (ou uma nova só com o header `Authorization`) — `SITE_URL`/`CRON_SECRET` são os já existentes no projeto (ver `.env.example` linhas 13 e 59), sem variável nova.

**Step 2: Validar e publicar o(s) workflow(s)**

`validate_workflow` → `publish_workflow`. Ativar (`active: true`) só depois de confirmar no `test_workflow`/`execute_workflow` que as duas chamadas retornam 200.

**Step 3: Remover `publish-scheduled` e `daily-schedule` do `cron-trigger.yml`**

Editar `.github/workflows/cron-trigger.yml`:
- Na etapa "Chamar crons de 5 em 5 minutos": remover `publish-scheduled` da lista `for path in drive-sync cutpro-pipeline generate-copy generate-art generate-video-art poll-video-render publish-scheduled`.
- Na etapa "Chamar crons de 30 em 30 minutos": remover `daily-schedule` da lista `for path in daily-schedule collect-metrics`.

**Step 4: Commit e push**

```bash
git add .github/workflows/cron-trigger.yml PLAN.md
git commit -m "feat(cron): n8n assume publish-scheduled/daily-schedule, remove do GitHub Actions"
git push origin main
```

Marcar T3 concluída em `PLAN.md`, com nota de qual workflow do n8n ficou responsável (ID + nome).

---

### Task 3 (T5): Teste ponta a ponta com aprovação real

Sem código a escrever — é um teste manual guiado. Passos:

**Step 1:** Confirmar que a migration 0031 está aplicada em produção (pré-requisito acima) e que Task 1 + Task 2 foram publicadas no n8n.

**Step 2:** Soltar 1 vídeo real na pasta sincronizada do Drive.

**Step 3:** Ativar o Schedule Trigger `A cada 10 minutos` do workflow de ingestão (se estiver desativado) e observar a execução em `search_executions` / `get_execution`.

**Step 4:** Confirmar no Supabase (`select * from posts where content_source = 'n8n' order by created_at desc limit 1;`) que o post aparece com `status = 'pendente_aprovacao'`, `caption` preenchida, `edit_status = 'editado'`, `edited_media_path` apontando pro path esperado no bucket `posts-media`.

**Step 5:** Abrir `/aprovacao` no painel, confirmar que o post aparece com preview do vídeo editado carregando do Storage.

**Step 6:** Aprovar o post pelo painel.

**Step 7:** Aguardar o próximo ciclo do Schedule Trigger de `publish-scheduled` (5 min) — confirmar no `posts` que `zernio_post_id` foi preenchido e, depois do polling assíncrono, que o status final reflete publicação real (via `lib/publishing/zernio.ts`, sem qualquer chamada Zernio vinda do n8n).

**Step 8:** Confirmar que `collect-metrics` (ainda no GitHub Actions) segue coletando analytics desse post normalmente — nenhuma lacuna no ciclo.

**Step 9:** Documentar o resultado em `PLAN.md` (data, ID do post, execução do n8n, link publicado) e marcar T5 concluída. Se tudo passou, marcar a seção M23 inteira como "pronta para avançar" conforme critério já escrito em `PLAN.md`.

```bash
git add PLAN.md
git commit -m "docs: fecha M23 (T1/T3/T5) — pipeline n8n->painel->Zernio validado ponta a ponta"
git push origin main
```

---

## Fora de escopo (reafirmado, não mexer)

- Reimplementar a chamada ao Zernio dentro do n8n (o achado acima é sobre **desconectar** o que já existe, não sobre reescrevê-lo).
- Ativar a aprovação via WhatsApp/Evolution API.
- Compressão automática de vídeo grande (M19).
- Qualquer alteração na fila de aprovação, RLS ou papéis do painel.
