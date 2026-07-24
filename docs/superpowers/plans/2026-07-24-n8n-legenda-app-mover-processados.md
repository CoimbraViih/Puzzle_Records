# n8n: legenda pelo app, dedup real e mover pra Processados assíncrono — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o painel Next.js gerar a legenda/manchete dos vídeos que o n8n edita via Cut.Pro (em vez do n8n gerar sozinho), corrigir a checagem de duplicado do n8n (hoje consulta uma Data Table morta) e mover o "mover vídeo pra Processados" pra depois da publicação de verdade (hoje acontece antes até de editar).

**Architecture:** Edição de vídeo continua 100% no n8n (Cut.Pro direto, sem passar pelo Supabase Storage — evita o teto de 50MB do plano Free). Um novo endpoint `POST /api/n8n/generate-caption` no painel Next.js expõe o motor de copy já existente (`generateCopyVariations`) pro n8n chamar via HTTP. Publicação continua exclusiva de `lib/publishing/zernio.ts`, disparada pelos crons `publish-scheduled`/`daily-schedule` já existentes — nada nesse plano toca a publicação. O workflow n8n `Puzzle Records — Drive → Instagram` (`CY4247mhDrxvBgfi`) é editado via MCP do n8n (`update_workflow`), não recriado do zero.

**Tech Stack:** Next.js App Router (route handlers), Supabase Postgres (migrations SQL), n8n (via MCP `update_workflow`/`get_workflow_details`), TypeScript.

## Global Constraints

- **Regra de ouro do projeto**: nenhum post publica sem passar pela fila de aprovação humana do painel — nenhuma tarefa deste plano toca publicação ou aprovação.
- **Nenhuma rota nova de publicação**: publicação continua só em `lib/publishing/zernio.ts`/`publish-scheduled`/`daily-schedule` — não duplicar idempotência/retry.
- **Edição de vídeo continua no n8n** chamando a Cut.Pro direto — não mover pro app (reabriria o teto de 50MB do Supabase Storage Free pro vídeo original).
- **Sem suíte de testes automatizada neste projeto** — verificação por `tsc --noEmit`, `eslint`, `next build` e teste manual (`curl`, execução real do workflow no n8n).
- **`CRON_SECRET`** é o único secret usado pra autenticar chamadas internas app↔n8n — não criar um secret novo.
- Git: commitar cada tarefa separadamente e dar `git push origin main` logo em seguida (sem pedir confirmação — só operações destrutivas exigem confirmação, ver `docs/CLAUDE.md`).

---

### Task 1: Migration `drive_file_id`/`drive_moved_at` + tipos TypeScript

**Files:**
- Create: `supabase/migrations/0032_posts_drive_dedup_columns.sql`
- Modify: `lib/types/post.ts` (interface `Post`, const `CONTENT_SOURCES`)

**Interfaces:**
- Produces: colunas `posts.drive_file_id` (`text`, nullable) e `posts.drive_moved_at` (`timestamptz`, nullable), consumidas pelas Tasks 3 e 4 (n8n) pra deduplicação e pro ramo de mover pra Processados. `ContentSource` TypeScript passa a incluir `"n8n"` (hoje só `"drive" | "acervo" | "painel"`, desalinhado com a constraint do banco desde a migration `0031_content_source_n8n.sql`).

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/0032_posts_drive_dedup_columns.sql
-- Colunas usadas pelo workflow n8n "Puzzle Records — Drive → Instagram"
-- pra deduplicação real (drive_file_id, em vez da Data Table interna do
-- n8n que parou de ser escrita desde a migração de estado pro Supabase,
-- migration 0031) e pro ramo assíncrono de mover o arquivo original pra
-- "Processados" só depois de publicado (drive_moved_at null = ainda não
-- movido; ver docs/superpowers/specs/2026-07-24-n8n-legenda-app-mover-processados-design.md).
alter table public.posts
  add column drive_file_id text,
  add column drive_moved_at timestamptz;

create index if not exists posts_drive_file_id_idx
  on public.posts (drive_file_id)
  where drive_file_id is not null;
```

- [ ] **Step 2: Atualizar `lib/types/post.ts`**

Em `lib/types/post.ts:21`, trocar:

```ts
export const CONTENT_SOURCES = ["drive", "acervo", "painel"] as const;
```

por:

```ts
export const CONTENT_SOURCES = ["drive", "acervo", "painel", "n8n"] as const;
```

Na interface `Post` (depois do campo `content_source: ContentSource;`, linha 82), adicionar:

```ts
  /** Preenchido só por posts vindos do n8n (content_source 'n8n') — id do
   * arquivo no Google Drive, usado pra deduplicação e pra mover o arquivo
   * pra "Processados" só depois de publicado (ver docs/superpowers/specs/
   * 2026-07-24-n8n-legenda-app-mover-processados-design.md). */
  drive_file_id: string | null;
  /** Preenchido quando o arquivo original já foi movido pra "Processados"
   * no Drive — null significa ainda não movido. */
  drive_moved_at: string | null;
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `lib/types/post.ts` (erros pré-existentes no restante do projeto, se houver, não são desta tarefa).

- [ ] **Step 4: Commit e push**

```bash
git add supabase/migrations/0032_posts_drive_dedup_columns.sql lib/types/post.ts
git commit -m "feat(db): adiciona drive_file_id/drive_moved_at em posts pro rework do n8n

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push origin main
```

**Nota de deploy:** esta migration precisa ser aplicada manualmente no projeto Supabase de produção (`dtfnxurjemdabqukgqzc`, SQL Editor) antes das Tasks 3/4 rodarem de verdade contra produção — mesmo padrão de risco já documentado em specs anteriores (ex.: `2026-07-21-quadro-renderizacao-design.md`) quando o MCP do Supabase não está disponível pra aplicar direto. Confirme isso antes da Task 5 (ativação end-to-end).

---

### Task 2: Endpoint `POST /api/n8n/generate-caption`

**Files:**
- Create: `app/api/n8n/generate-caption/route.ts`

**Interfaces:**
- Consumes: `generateCopyVariations({ mode: "text", postType, fact, trackName })` de `lib/openai/generateCopy.ts` (já existe, assinatura confirmada: `Promise<CopyVariation[]>`, `CopyVariation = { headline: string; caption: string }`); `POST_TYPES`/`PostType` de `lib/types/post.ts` (já existe).
- Produces: rota HTTP `POST /api/n8n/generate-caption`, consumida pela Task 3 (workflow n8n). Contrato: request `{ postType?: string; fact: string }`, response de sucesso `{ headline: string; caption: string; variations: { headline: string; caption: string }[] }` (200), erro `{ error: string }` (401/400/502).

- [ ] **Step 1: Criar a rota**

```ts
// app/api/n8n/generate-caption/route.ts
import { NextResponse } from "next/server";

import {
  CopyGenerationError,
  generateCopyVariations,
} from "@/lib/openai/generateCopy";
import { POST_TYPES, type PostType } from "@/lib/types/post";

// Chamada pelo workflow n8n "Puzzle Records — Drive → Instagram" depois que
// a Cut.Pro já clipou o vídeo — só cobre o modo "text" do motor de copy
// existente (o título/resumo do clipe já é o contexto, não reanalisa vídeo
// aqui). Ver docs/superpowers/specs/2026-07-24-n8n-legenda-app-mover-processados-design.md.
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { postType?: unknown; fact?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const postType = String(body.postType ?? "viral_geral") as PostType;
  const fact = String(body.fact ?? "").trim();

  if (!POST_TYPES.includes(postType)) {
    return NextResponse.json({ error: "invalid_post_type" }, { status: 400 });
  }
  if (!fact) {
    return NextResponse.json({ error: "missing_fact" }, { status: 400 });
  }

  try {
    const variations = await generateCopyVariations({
      mode: "text",
      postType,
      fact,
      trackName: null,
    });

    return NextResponse.json({
      headline: variations[0].headline,
      caption: variations[0].caption,
      variations,
    });
  } catch (err) {
    const message =
      err instanceof CopyGenerationError
        ? err.message
        : "Falha ao gerar manchete/legenda via OpenAI.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verificar tipos e lint**

Run: `npx tsc --noEmit && npx eslint app/api/n8n/generate-caption/route.ts`
Expected: sem erros.

- [ ] **Step 3: Testar manualmente contra o deploy de produção**

```bash
set -a; source .env.local; set +a
curl -sS -w "\nstatus=%{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"postType":"viral_geral","fact":"Bastidor de show da Puzzle Records, artista comemorando com a torcida depois de bater recorde de plays."}' \
  "https://puzzle-records-bldm.vercel.app/api/n8n/generate-caption"
```

Expected: `status=200` e JSON com `headline`, `caption`, `variations` (array com 2-3 itens) — **este teste só funciona depois do deploy da Task 2 estar no ar em produção** (a Vercel faz deploy automático a partir de `main`, ver `docs/CLAUDE.md`). Se rodar antes do deploy propagar, vai dar 404; espere alguns minutos e repita.

Teste negativo (sem auth):
```bash
curl -sS -w "\nstatus=%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{"fact":"x"}' \
  "https://puzzle-records-bldm.vercel.app/api/n8n/generate-caption"
```
Expected: `status=401`.

- [ ] **Step 4: Commit e push**

```bash
git add app/api/n8n/generate-caption/route.ts
git commit -m "feat(api): rota /api/n8n/generate-caption pro n8n gerar legenda via app

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Workflow n8n — legenda pelo app + `drive_file_id` no insert

**Files:**
- Nenhum arquivo local — edição feita via MCP do n8n (`mcp__claude_ai_n8n__update_workflow`) no workflow `CY4247mhDrxvBgfi` ("Puzzle Records — Drive → Instagram").

**Interfaces:**
- Consumes: rota `POST /api/n8n/generate-caption` da Task 2 (contrato exato acima); credencial n8n existente `Header Auth account` (id `rOgtQZXX29TYxW1a`, tipo `httpHeaderAuth`) — já cadastrada, só precisa ser anexada ao nó novo.
- Produces: workflow atualizado onde "Registrar: pendente de aprovação" grava `caption`/`headline` vindos da resposta HTTP em vez do antigo `Agente de Legendas`; "Registrar: processando" grava `drive_file_id`.

**Contexto para quem executa (fresh subagent, sem histórico da investigação anterior):** este workflow já existe e funciona — NÃO recriar do zero. Antes de qualquer mudança, **invoque a skill `using-n8n-mcp-skills`** (ou pelo menos `n8n-mcp-tools-expert`) e leia `get_sdk_reference`/`get_workflow_best_practices` se for compor nós novos — os nós HTTP Request deste workflow já seguem o padrão `n8n-nodes-base.httpRequest` typeVersion `4.4` (ver nós existentes como `"Cut.Pro: iniciar upload"`), reaproveite esse padrão pro nó novo em vez de inventar outro tipo.

- [ ] **Step 1: Buscar o estado atual do workflow**

Chame `get_workflow_details` com `workflowId: "CY4247mhDrxvBgfi"`. Confirme que os nós a seguir ainda existem com esses nomes exatos (podem ter sido alterados desde que este plano foi escrito — se os nomes não baterem, pare e avise, não adivinhe): `"Agente de Legendas"`, `"Saída estruturada"`, `"GPT-4o"`, `"OpenRouter Chat Model"`, `"Baixar vídeo editado"`, `"Registrar: pendente de aprovação"`, `"Registrar: processando"`, `"Escolher melhor clipe"`.

Hoje as conexões relevantes são:
- `"Baixar vídeo editado"` → `["Agente de Legendas", "Supabase: upload vídeo editado"]` (dois branches em paralelo)
- `"Agente de Legendas"` → `"Registrar: pendente de aprovação"`
- `"Registrar: pendente de aprovação"` grava (entre outros campos): `caption: "={{ $json.output.legenda }}"`, sem gravar `headline` nenhum (gap pré-existente — o post de vídeo do n8n nunca teve manchete, só legenda; corrigir isso é parte desta tarefa).
- `"Registrar: processando"` (nó `n8n-nodes-base.supabase`, insert em `posts`) hoje NÃO grava `drive_file_id`.

- [ ] **Step 2: Descobrir o schema do nó HTTP Request novo**

Chame `search_nodes(["http request"])` e `get_node_types` para `n8n-nodes-base.httpRequest` (já usado no workflow, mas confirme a versão/parâmetros exatos antes de montar o node novo). Valide a config com `validate_node_config` antes de aplicar via `update_workflow`.

- [ ] **Step 3: Adicionar o nó "Gerar legenda (app)"**

Via `update_workflow` (`workflowId: "CY4247mhDrxvBgfi"`), operação `addNode`:
- `name`: `"Gerar legenda (app)"`
- `type`: `"n8n-nodes-base.httpRequest"`, `typeVersion`: `4.4` (mesma versão dos outros HTTP Request deste workflow)
- `parameters` (adaptar ao schema confirmado no Step 2, mas o contrato de negócio é este):
  - `method`: `POST`
  - `url`: `https://puzzle-records-bldm.vercel.app/api/n8n/generate-caption` (mesma URL de produção usada no workflow de crons, `rKHuyk9Sgr0CMLch`)
  - Autenticação: `genericCredentialType` / `httpHeaderAuth`, mesma credencial `Header Auth account` já usada em `"Chamar publish-scheduled"` do outro workflow (`credentialId: "rOgtQZXX29TYxW1a"`) — usar a operação `setNodeCredential` depois de criar o nó.
  - Body JSON: `{ "postType": "viral_geral", "fact": "={{ 'Título: ' + ($('Escolher melhor clipe').first().json.title || '') + '. Resumo: ' + ($('Escolher melhor clipe').first().json.description || '') }}" }` — `postType` fixo em `"viral_geral"` porque o workflow do n8n não classifica o tipo de post hoje (mesmo default usado no resto do sistema pra conteúdo de acervo/volume).
- Posicione o nó (`position`) entre `"Baixar vídeo editado"` e `"Registrar: pendente de aprovação"` no canvas (ex.: `[4080, 96]`, mesma área dos nós de IA que estão sendo removidos).

Valide com `validate_node_config` antes de chamar `update_workflow`.

- [ ] **Step 4: Rewire das conexões**

Via `update_workflow`, mesma chamada ou uma seguinte (operações atômicas, pode agrupar):
- `removeConnection`: source `"Baixar vídeo editado"` → target `"Agente de Legendas"`
- `addConnection`: source `"Baixar vídeo editado"` → target `"Gerar legenda (app)"`
- `removeConnection`: source `"Agente de Legendas"` → target `"Registrar: pendente de aprovação"`
- `addConnection`: source `"Gerar legenda (app)"` → target `"Registrar: pendente de aprovação"`

(A conexão `"Baixar vídeo editado"` → `"Supabase: upload vídeo editado"` NÃO muda — continua em paralelo.)

- [ ] **Step 5: Remover os 4 nós de IA antigos**

Via `update_workflow`, `removeNode` para: `"Agente de Legendas"`, `"Saída estruturada"`, `"GPT-4o"`, `"OpenRouter Chat Model"`. (Remover um nó em n8n já remove as conexões que apontam pra ele — confirme depois com `get_workflow_details` que não sobrou conexão órfã.)

- [ ] **Step 6: Atualizar "Registrar: pendente de aprovação" pra ler da nova resposta**

Via `update_workflow`, operação `updateNodeParameters` no nó `"Registrar: pendente de aprovação"`: trocar o `fieldValue` de `caption` de `"={{ $json.output.legenda }}"` para `"={{ $json.caption }}"`, e **adicionar** um novo `fieldValue` `headline` com `"={{ $json.headline }}"` (campo que este nó nunca preencheu antes — gap corrigido nesta tarefa).

- [ ] **Step 7: Adicionar `drive_file_id` em "Registrar: processando"**

Via `update_workflow`, operação `updateNodeParameters` no nó `"Registrar: processando"`: adicionar `fieldValue` `drive_file_id` com `"={{ $('Selecionar 1 vídeo').first().json.id }}"` (mesma expressão já usada em `media_url` pra obter o id do arquivo).

- [ ] **Step 8: Confirmar consistência do workflow**

Chame `get_workflow_details` de novo e `validate_workflow` (se aplicável ao workflow existente) — confirme: nenhuma conexão apontando pra um nó removido; `"Gerar legenda (app)"` está entre `"Baixar vídeo editado"` e `"Registrar: pendente de aprovação"`; `"Registrar: processando"` e `"Registrar: pendente de aprovação"` têm os campos novos.

- [ ] **Step 9: Registrar a mudança**

A própria chamada `update_workflow` já grava versão no histórico (parâmetro `versionName`/`versionDescription`) — preencha com algo como `versionName: "Legenda via app + drive_file_id"`, `versionDescription: "Substitui Agente de Legendas (LangChain/OpenRouter) por chamada a /api/n8n/generate-caption; adiciona drive_file_id no insert; grava headline (antes só caption)."`. Não há commit de código local nesta tarefa (mudança vive só no n8n) — não pular o `versionName`, é o único rastro de auditoria disponível.

---

### Task 4: Workflow n8n — deduplicação real (Supabase em vez da Data Table morta)

**Files:**
- Nenhum arquivo local — edição via MCP do n8n no mesmo workflow `CY4247mhDrxvBgfi`.

**Interfaces:**
- Consumes: coluna `posts.drive_file_id` (Task 1, já deve estar aplicada em produção antes desta tarefa) e o campo já gravado por "Registrar: processando" (Task 3).
- Produces: nó `"Somente não processados"` filtrando de verdade contra o Supabase.

**Contexto:** hoje `"Somente não processados"` é um nó `n8n-nodes-base.dataTable`, operação `rowNotExists`, contra a Data Table `puzzle_posts` (id `Y3iaX0wtoYBINVlz`) — essa Data Table parou de ser escrita desde a Task 3/decisão de 21/07/2026, então a checagem hoje **sempre passa** (nunca filtra nada) independente do vídeo já ter sido processado. Precisa virar uma consulta real em `posts` (Supabase), filtrando por `drive_file_id` igual ao id do arquivo do Drive sendo avaliado, e só deixar passar quando **não existir** post com aquele `drive_file_id`.

- [ ] **Step 1: Descobrir o schema do nó Supabase de leitura**

Chame `search_nodes(["supabase"])` e `get_node_types` para `n8n-nodes-base.supabase` com a operação de leitura/listagem (provavelmente `getAll`, confirme o nome exato e o formato de filtro no resultado — os nós já existentes neste workflow usam esse tipo só pra `update`/`insert`, a operação de leitura ainda não foi usada aqui). Valide com `validate_node_config` antes de aplicar.

- [ ] **Step 2: Substituir o nó**

O tipo de nó muda inteiramente (de `dataTable` pra `supabase`), então não dá pra só trocar parâmetros — via `update_workflow`:
- `removeNode`: `"Somente não processados"` (o antigo, tipo `dataTable`)
- `addNode`: novo nó, mesmo nome `"Somente não processados"`, `type: "n8n-nodes-base.supabase"`, operação de leitura confirmada no Step 1, filtrando `posts` por `drive_file_id = {{ $json.id }}` (o `$json.id` vem do item de arquivo do Drive, saído de `"Separar arquivos"`).
- Regra de negócio que o nó (ou um nó `IF`/`Filter` logo depois, se a operação escolhida não filtrar itens sozinha) precisa impor: **só segue adiante quando a consulta não retornar nenhuma linha** para aquele `drive_file_id`. Se a operação `getAll` do Supabase, ao não achar nada, simplesmente não emitir nenhum item de saída pra aquele input (comportamento comum de nós de API n8n) — não precisa de nó extra. Se ela emitir um item com array vazio em vez de "nenhum item", adicione um nó `n8n-nodes-base.filter` logo depois, condição `{{ $json.length === 0 }}` (ou equivalente confirmado na prática rodando `test_workflow`), antes de reconectar em `"Selecionar 1 vídeo"`.
- Reconectar: `"Separar arquivos"` → `"Somente não processados"` (novo) → (filtro extra, se necessário) → `"Selecionar 1 vídeo"` — mesma topologia de antes.

- [ ] **Step 3: Testar com `test_workflow` ou `prepare_test_pin_data`**

Use os dados de um arquivo já processado (algum `drive_file_id` que já exista em `posts` de testes anteriores, ex.: os IDs usados nas execuções 32-34 documentadas no `docs/CLAUDE.md`) e confirme que ele **não** passa pelo nó; use um id fictício que não existe em `posts` e confirme que **passa**.

- [ ] **Step 4: Registrar a mudança**

Mesma chamada de `update_workflow` (ou uma nova), com `versionName: "Dedup real via Supabase"`, `versionDescription: "Somente não processados passa a consultar posts.drive_file_id em vez da Data Table puzzle_posts (morta desde a migração de estado pro Supabase)."`.

---

### Task 5: Workflow n8n — mover pra Processados vira assíncrono

**Files:**
- Nenhum arquivo local — edição via MCP do n8n no mesmo workflow `CY4247mhDrxvBgfi`.

**Interfaces:**
- Consumes: `posts.content_source = 'n8n'`, `posts.status = 'publicado'` (já gravado pelo `publish-scheduled` do app, fora do escopo deste plano), `posts.drive_moved_at` (Task 1), `posts.drive_file_id` (Task 1/3).
- Produces: ramo novo e independente dentro do mesmo workflow que move o arquivo do Drive pra "Processados" só depois de `status = 'publicado'`, e remove o nó antigo que movia cedo demais.

**Contexto:** hoje `"Registrar: processando"` → `"Mover vídeo p/ Processados (Drive)"` → `"Cut.Pro: iniciar upload"` — o arquivo sai da pasta de origem **antes** até de começar a editar. O nó de mover (`n8n-nodes-base.httpRequest`, `PATCH` em `https://www.googleapis.com/drive/v3/files/{id}?addParents=1LIwK57bJCSBKEI1l01B1X2x6m59bgCVM&removeParents=1-yug-QANV_pGHpmgWJ021L6hQDeV7Ann`) tem a lógica certa de mover — só precisa rodar no momento certo, disparado por outro gatilho.

- [ ] **Step 1: Remover o nó do fluxo linear**

Via `update_workflow`:
- `removeConnection`: source `"Registrar: processando"` → target `"Mover vídeo p/ Processados (Drive)"`
- `addConnection`: source `"Registrar: processando"` → target `"Cut.Pro: iniciar upload"` (pula direto, restaurando a ligação que existia antes do nó de mover ser inserido no meio)
- **Não** delete o nó `"Mover vídeo p/ Processados (Drive)"` ainda — ele será reaproveitado no novo ramo (Step 3), só fica temporariamente sem conexão de entrada.

- [ ] **Step 2: Adicionar o Schedule Trigger do novo ramo**

`search_nodes(["schedule trigger"])` + `get_node_types` pra confirmar o schema (mesmo tipo do `"A cada 10 minutos"` já existente, `n8n-nodes-base.scheduleTrigger`, típicamente `typeVersion 1.3`). Via `update_workflow`, `addNode`:
- `name`: `"A cada 10 minutos (mover Processados)"`
- `type`: `"n8n-nodes-base.scheduleTrigger"`, mesmo intervalo do trigger principal (10 minutos)
- Posicione longe do fluxo principal no canvas (ex.: `[-1200, 700]`) pra não confundir visualmente com `"A cada 10 minutos"` original.

- [ ] **Step 3: Adicionar a consulta Supabase e rewire do "Mover vídeo p/ Processados"**

`get_node_types` pra `n8n-nodes-base.supabase` (mesma operação de leitura confirmada na Task 4, Step 1) — `addNode`:
- `name`: `"Buscar publicados p/ mover"`
- Filtra `posts` por `content_source = 'n8n' AND status = 'publicado' AND drive_moved_at IS NULL` (ajuste ao formato de filtro real do node, confirmado via `get_node_types`/`validate_node_config`).

Conecte: `"A cada 10 minutos (mover Processados)"` → `"Buscar publicados p/ mover"` → `"Mover vídeo p/ Processados (Drive)"` (reaproveitando o nó existente — mas troque o parâmetro da URL: hoje ele lê o id via `$('Selecionar 1 vídeo').first().json.id`, que não existe nesse novo ramo; troque pra `$json.drive_file_id` do item vindo de `"Buscar publicados p/ mover"`).

- [ ] **Step 4: Marcar como movido**

`addNode`, tipo `n8n-nodes-base.supabase`, operação `update` (mesmo padrão dos nós `"Registrar: publicado"`/`"Registrar erro..."` já existentes):
- `name`: `"Marcar drive_moved_at"`
- `tableId`: `posts`
- Filtro: `id = {{ $json.id }}` (id do post, vindo de `"Buscar publicados p/ mover"`)
- `fieldsUi`: `drive_moved_at = {{ $now.toISO() }}`

Conecte: `"Mover vídeo p/ Processados (Drive)"` → `"Marcar drive_moved_at"`.

Erro: adicione tratamento equivalente ao resto do workflow — se o `PATCH` no Drive falhar, grave em `cutpro_error` do post (reaproveita a coluna existente) em vez de travar o ciclo seguinte; use `onError: "continueErrorOutput"` no nó `"Mover vídeo p/ Processados (Drive)"` (operação `setNodeSettings`) ligado a um novo nó `n8n-nodes-base.supabase` de update gravando o erro, mesmo padrão de `"Registrar erro (clipagem)"`/`"Registrar erro (render)"` já existentes no workflow.

- [ ] **Step 5: Testar**

Use `test_workflow` com um post fictício `content_source='n8n', status='publicado', drive_moved_at=null` (inserir via Supabase antes do teste, ou usar `prepare_test_pin_data`) e confirme: o arquivo é movido no Drive, `drive_moved_at` é gravado, e rodar o ramo de novo não tenta mover o mesmo arquivo (porque o filtro `drive_moved_at IS NULL` já exclui).

- [ ] **Step 6: Registrar a mudança**

`update_workflow` com `versionName: "Mover pra Processados vira assíncrono"`, `versionDescription: "Remove o move-cedo-demais do fluxo linear; novo ramo (Schedule Trigger próprio) move o arquivo só depois de posts.status='publicado', usando drive_file_id/drive_moved_at (migration 0032)."`.

---

### Task 6: Ativação e validação end-to-end

**Files:** nenhum — passo operacional.

**Interfaces:** nenhuma nova; consome tudo das Tasks 1-5.

- [ ] **Step 1: Confirmar que a migration 0032 foi aplicada em produção**

Rode contra o Supabase de produção (mesmo padrão de teste usado na sessão de verificação anterior):

```bash
set -a; source .env.local; set +a
curl -sS -D - -o /dev/null \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/posts?select=drive_file_id,drive_moved_at&limit=1"
```

Expected: `200` (se a coluna não existir, PostgREST responde `42703 column does not exist` — nesse caso, aplique a migration manualmente no SQL Editor do projeto `dtfnxurjemdabqukgqzc` antes de continuar).

- [ ] **Step 2: Ativar os dois workflows n8n**

Via MCP do n8n, ative (`active: true`) `CY4247mhDrxvBgfi` (Drive → Instagram) e `rKHuyk9Sgr0CMLch` (Crons de publicação) — hoje ambos `active: false`. Confirme com `get_workflow_details` que `"active": true` em ambos depois.

- [ ] **Step 3: Teste manual ponta a ponta**

Solte um vídeo real na pasta do Drive monitorada (`1-yug-QANV_pGHpmgWJ021L6hQDeV7Ann`) e observe, ao longo dos próximos ciclos:
1. O vídeo vira uma linha em `posts` com `content_source = 'n8n'`, `drive_file_id` preenchido.
2. `caption`/`headline` batem com o que a rota `/api/n8n/generate-caption` retornaria pro título/resumo daquele clipe (confira via log de execução do n8n, nó `"Gerar legenda (app)"`).
3. Soltar o **mesmo vídeo de novo** (ou deixar o cron rodar de novo antes dele ser movido) não cria uma segunda linha em `posts` pro mesmo `drive_file_id`.
4. O arquivo continua na pasta de origem enquanto o post está em `pendente_aprovacao`/`aprovado` (ainda não publicado).
5. Aprove o post manualmente na fila do painel (`/aprovacao`) — depois que `publish-scheduled` publicar (`status` vira `publicado`), confirme que o arquivo é movido pra "Processados" no próximo ciclo do ramo assíncrono (Task 5) e que `drive_moved_at` é gravado.

**Pronto para avançar quando**: os 5 pontos do Step 3 forem confirmados com um vídeo real, sem erro em `cutpro_error`/`publish_error` no post de teste.
