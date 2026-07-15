# M16 — Página "Drive" + Integração Cut.Pro

Plano técnico do milestone descrito em [PLAN.md#m16](../../PLAN.md#m16--página-drive--integração-cutpro-planejado-14072026) e [docs/CLAUDE.md](../CLAUDE.md). Fonte de verdade do *escopo e da superfície real da API Cut.Pro* é `PLANO-INTEGRACAO-CUTPRO.md` (registro de sessão de 14/07/2026, na raiz do repo, **não commitado** — é o próprio PLAN.md que aponta pra ele como fonte de verdade do sumário D0–D6); este documento detalha *como* implementar cada tarefa contra o código real do repositório, levantado por exploração direta em 15/07/2026.

**Nota de sequenciamento a confirmar com o Victor**: `PLANO-DE-IMPLEMENTACAO.md` (v4, também de 14/07, não commitado) descreve o Cut.Pro como **complementar** ao motor Remotion existente (M14) — não um substituto — e recomenda encaixá-lo **depois do piloto (M13)**, para comparar os dois lado a lado (inclusive legenda com gíria de funk) antes de decidir o padrão de produção. O PLAN.md já commitado, por outro lado, lista M16 na sequência logo após M15 sem esse gate explícito. Implementação abaixo (D1) é código puro, não decide isso — mas D3 (envio para aprovação usando Cut.Pro em produção real) só deveria rodar depois que essa decisão de sequência for confirmada.

## Escopo e princípios (não repetir decisão, só aplicar)

- Regra de ouro intocada: nada publica sem passar pela fila de aprovação existente.
- Publicação continua exclusiva via Zernio — Cut.Pro só edita vídeo.
- Erro nunca silencioso — todo campo novo segue o idioma `*_error` já usado em `posts` (`art_generation_error`, `copy_generation_error`, `publish_error`, `ingestion_warning`).
- Camada isolada `lib/cutpro/` espelhando exatamente `lib/publishing/` (types.ts + client concreto + index.ts como única fronteira de import).
- Vercel orquestra, Railway (`render-worker/`) transfere bytes — mesmo motivo do M14 (teto de 60s do plano Hobby).
- **Quebra de comportamento consciente**: `drive-ingest` (M3) hoje cria post automaticamente. Passa a virar `drive-sync`, só espelha — a criação de post migra para a ação manual "Enviar para aprovação" na nova página `/drive` (D5).

## D0 — Preparação (Victor, fora do código) — feito em 15/07/2026

- Chave gerada e validada contra a API real: `GET /balance` → 349 créditos; `GET /workspace` → workspace pessoal `pw27390459223474176`, plano **Plus** (não é o plano gratuito de 15 créditos).
- Template da casa salvo na conta (`GET /templates?filter=mine`): `cutpro_template_id` **80009919218057216** ("n3on (cópia)"), `auto_add_captions: true`, `aspect_ratio: 9:16`, `is_public: false` (cópia própria, aceito por `apply_template`/`submitClipping`).
- **Pendente**: confirmação de ausência de marca d'água — o plano Plus não é documentado publicamente como "sem marca d'água" por padrão; só se confirma no primeiro `completeUpload`/`renderClip` real (`force_watermark`/`has_watermark` na resposta). Tratado como erro explícito em D4 se vier `true`.

## Correção de D1 (15/07/2026) — API real validada

O rascunho original desta seção chutou `https://api.cutpro.io/v1` como base — domínio que **não existe** (`api.cutpro.io` não resolve). A base real, confirmada contra `cut.pro/docs` e testada com a chave real, é `https://api.cut.pro/api/v1`. `lib/cutpro/client.ts`/`types.ts` foram reescritos 1:1 contra a doc oficial (não mais um "stub best-effort"):

- Upload: `POST /videos/upload` (`file_name`+`file_size` obrigatórios, não só `filename`) → `PUT` bytes na `upload_url` → `POST /videos/upload/complete` (`video_id`+`file_name`+`duration`+`width`+`height`) — **este endpoint já retorna o pre-flight de créditos/marca d'água** (`credits_cost`, `force_watermark`, `current_balance`); não existe um endpoint de "analyze" separado para vídeo próprio (`/clips/info` é só para URL pública de terceiros — YouTube/Twitch/etc., fora do escopo do M16).
- Clipagem: `POST /clips` (não `/clipping-submissions`) — aceita `template_id` direto no corpo, então os clipes já podem sair com o template aplicado sem precisar do `apply_template` separado no caminho feliz. `GET /clips/{videoId}/submissions/{submissionId}` faz polling (status `queued|downloading|transcribing|video_analysis|analyzing|finalizing|completed|failed`); `GET /clips/{videoId}/submissions/{submissionId}/clips` lista os clipes (campo de score é `rating`, não `score`; `has_template_applied` indica se já saiu com template).
- Template avulso (fallback, se o template só for escolhido depois de ver os clipes): `POST /clips/{videoId}/submissions/{submissionId}/apply_template` — 429 `BATCH_ALREADY_RUNNING` confirmado.
- Render: `POST /clips/{videoId}/submissions/{submissionId}/clips/{clipId}/render` — pode devolver 200 com `download_url` já pronto (cache) ou 202 com `render_id` pra poll; `GET /renders/{renderId}` (status `queued|active|completed|failed|cancelled|expired` + `progress`); `GET /renders/{renderId}/download` (`url`+`filename`, expira em 1h).
- `GET /templates?filter=mine|public`, `GET /balance` — confirmados 1:1 com o rascunho original.
- **Simplificação a considerar no D4**: como `submitClipping` já aceita `template_id`, dá pra colapsar os estados `clipando`+`aplicando` em um só quando o template é conhecido de antemão (é o caso do M16 — sempre o template da casa) — mantendo `aplicando` só como fallback se um dia a escolha de template acontecer depois de ver os clipes gerados.

## D1 — Fundação

### Migration `supabase/migrations/0019_drive_cutpro.sql`

Segue o idioma de `0013_notifications.sql` (RLS mínima, insert só via service-role) e `0014_video_templates.sql` (tabela de feature + trigger `set_updated_at` + `is_admin()` para escrita admin):

```sql
create table public.drive_items (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  drive_metadata_file_id text,
  filename text not null,
  media_type text not null check (media_type in ('image','video')),
  media_storage_path text,           -- espelho já baixado para Storage (posts-media)
  removed_from_drive boolean not null default false,

  caption text,
  caption_variations jsonb,
  caption_error text,

  edit_status text not null default 'nao_editado'
    check (edit_status in ('nao_editado','enviando','clipando','aplicando','renderizando','editado','erro')),
  cutpro_video_id text,               -- startUpload/completeUpload
  cutpro_submission_id text,          -- submitClipping/getSubmission/listClips
  cutpro_clip_id text,                -- clip escolhido de listClips
  cutpro_template_id text,
  cutpro_render_id text,              -- applyTemplate/renderClip/getRender/getRenderDownloadUrl
  cutpro_error text,
  edited_media_path text,            -- resultado do Cut.Pro, já em Storage

  post_id uuid references public.posts (id),  -- trava contra envio duplicado (D5)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger drive_items_set_updated_at
  before update on public.drive_items
  for each row execute function public.set_updated_at();

alter table public.drive_items enable row level security;

create policy "drive_items_select_authenticated" on public.drive_items
  for select using (auth.uid() is not null);

-- equipe_conteudo/aprovador/admin podem gerar legenda e editar; nunca criam/apagam a linha (isso é do cron)
create policy "drive_items_update_authenticated" on public.drive_items
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

alter table public.templates
  add column provider text not null default 'remotion' check (provider in ('remotion','cutpro')),
  add column cutpro_template_id text;
```

Observação: `post_id` guarda a trava contra duplo envio (D5); `edit_status` é a máquina de estados do D4 (retomável — cada valor mapeia 1:1 a um passo da chamada Cut.Pro).

### `lib/cutpro/` (mesmo padrão de `lib/publishing/`)

A API real do Cut.Pro (auditada por Victor em 13/07/2026) **não** é um simples "upload + apply_template" — é um pipeline de clipagem por IA de vídeo-fonte seguido de aplicação de template e render assíncrono, com `/templates` somente leitura (`applyTemplate` só aceita template já copiado pra conta própria, `filter=mine`):

- `lib/cutpro/types.ts` — `CutProTemplate`, `AnalyzeVideoResult` (créditos estimados + duração), `UploadHandle`, `ClippingSubmission`, `Clip`, `RenderStatus` (`processing|done|error`, `fromCache`, `hasWatermark`, `error`), `CutProBalance`, e `CutProError`/`CutProRateLimitError` (mesmo espírito de `PublishError`/`PublishPendingError`: `429 BATCH_ALREADY_RUNNING` — só 1 job de `applyTemplate`/`renderClip` por vez no plano — vira retry no próximo ciclo, não erro real).
- `lib/cutpro/client.ts` — `requireApiKey()` (falha explícita se `CUTPRO_API_KEY` ausente; `CUTPRO_WORKSPACE_ID` é opcional, só planos multi-workspace), auth via header `X-Api-Key`. Funções: `analyzeVideo`, `startUpload`/`completeUpload`, `submitClipping`/`getSubmission`/`listClips`, `applyTemplate`/`renderClip`/`getRender`/`getRenderDownloadUrl`, `listTemplates(filter)`, `getBalance()` — nomes espelhando 1:1 os da auditoria real, não inventados.
- `lib/cutpro/index.ts` — reexporta tudo; única fronteira de import para o resto do app (mesmo padrão de `lib/publishing/index.ts`).
- **Implementado nesta sessão como stub best-effort** (mesmo estágio do Zernio pré-M12): a auditoria confirma nomes/fluxo/constraints, não o schema JSON exato de cada request/response — validar contra chamadas reais é ajuste de implementação, não redesenho, graças ao isolamento.

### `.env.example`

Bloco novo após o de Render Worker, mesmo estilo (comentário explicando onde obter):

```
# Cut.Pro — edição de vídeo com template da casa (gerar em cutpro.<...>/settings/api)
CUTPRO_API_KEY=
CUTPRO_WORKSPACE_ID=
```

## D2 — Página "Drive" na navegação

- Nova rota `app/(dashboard)/drive/page.tsx`, server component, `export const dynamic = "force-dynamic"`, mesmo esqueleto de `app/(dashboard)/templates/page.tsx` (`PageHeader` + grid de cards client).
- `lib/drive/mirror.ts` (novo): `listDriveItems()` — lê `drive_items` ordenado por `created_at desc`.
- Botão "Atualizar agora" chama uma server action que roda a mesma lógica de listagem/espelhamento do cron (extraída para uma função pura reaproveitável pelo cron **e** pela página, em vez de duplicar).
- **Renomeação do cron**: `app/api/cron/drive-ingest/` vira `app/api/cron/drive-sync/` (registrado no `.github/workflows/cron-trigger.yml` no lugar do antigo). A lógica de `ingestFilePair` deixa de inserir em `posts` diretamente — passa a fazer *upsert* em `drive_items` (baixa bytes, sobe pro Storage, grava `media_storage_path`, `filename`, `media_type`). Reaproveita 100% de `pairFiles`/`parseMetadata`/`extractContextFromFilename` para povoar `caption`/contexto inicial se o `.json` já tiver `fato`.
- Arquivo removido da pasta do Drive: próxima sincronização marca `removed_from_drive = true` no espelho **sem apagar a linha** se `post_id` já estiver preenchido (mantém histórico); se `post_id` for nulo, pode remover a linha (nunca virou post).

## D3 — Legenda por IA na página

- Server action `lib/drive/actions.ts` → `generateDriveItemCaption(driveItemId)`:
  - Busca o `drive_item`, monta `GenerateCopyInput` — `mode:"video"` (baixa o vídeo do Storage, chama `generateCopyVariations`) ou `mode:"text"` (usa `caption`/contexto digitado no painel, mesmo campo de contexto do upload direto do M11).
  - Mesmo try/catch de `createPostWithAI` (`lib/posts/actions.ts:181-207`): sucesso grava `caption`/`caption_variations`, limpa `caption_error`; falha grava `caption_error`, nunca lança pro cliente sem contexto.
- UI: botão "Gerar legenda" no card do item, picker de variação (mesmo padrão dos cards do Kanban), edição inline do texto escolhido, retry visível quando `caption_error` está preenchido.

## D4 — Edição de vídeo via Cut.Pro

Etapa de maior risco/complexidade — só testável ponta a ponta depois do D0. Escopo desta sessão: implementar a máquina de estados e os adapters; validação contra API real fica para quando a chave existir.

- Botão "Editar com template" → `listTemplates("mine")` (Cut.Pro) para o seletor — só templates já copiados pra conta própria são aceitos por `applyTemplate` (público não copiado → `TEMPLATE_NOT_FOUND`); grava `cutpro_template_id` escolhido.
- Pre-flight: `analyzeVideo()` retorna estimativa de créditos + duração antes de gastar nada.
- Máquina de estados em `edit_status` (`enviando→clipando→aplicando→renderizando→editado`), avançada pelo novo cron `app/api/cron/cutpro-pipeline/route.ts` (GitHub Actions, 5 min, mesmo padrão de auth `CRON_SECRET` fail-closed e claim atômico via update condicional de `publish-scheduled`/`poll-video-render`):
  - `enviando`: `startUpload()` + sobe bytes do vídeo original pro endpoint novo do `render-worker` (`POST /transfer/upload-to-cutpro`, mesma auth `RENDER_WORKER_SECRET`, streaming), depois `completeUpload(videoId)` → grava `cutpro_video_id`.
  - `clipando`: `submitClipping(videoId)` → `cutpro_submission_id`; poll via `getSubmission()`; ao concluir, `listClips()` escolhe o clipe (critério de seleção — maior `score`, a definir na implementação) → `cutpro_clip_id`.
  - `aplicando`: `applyTemplate(clipId, templateId)` → `cutpro_render_id`, depois `renderClip(renderId)`; **serializado por conta** (1 job Cut.Pro por vez — plano recusa concorrência); `429 BATCH_ALREADY_RUNNING` (`CutProRateLimitError`) tratado como "tentar de novo no próximo ciclo", nunca como erro.
  - `renderizando`: `getRender(renderId)` — `processing` não faz nada; `error` ou `hasWatermark: true` grava `cutpro_error`; `done` (`fromCache` pula direto ao download, sem novo custo) chama `getRenderDownloadUrl()` (**expira em 1h — download imediato**) via `GET /transfer/download-from-cutpro` novo do `render-worker` e sobe pro Storage (`edited_media_path`), fecha em `editado`.
- Cada transição usa o mesmo idioma de claim atômico (`update ... where edit_status = X ... select id`) já usado por `poll-video-render` — retomável se o cron for interrompido no meio.

## D5 — Enviar para aprovação

- Botão "Enviar para aprovação" no card do item (`/drive`) → server action `sendDriveItemToApproval(driveItemId)`:
  - Recusa se `drive_items.post_id` já preenchido (trava contra duplo envio).
  - Usa `edited_media_path` se existir (vídeo editado via Cut.Pro), senão `media_storage_path` (original).
  - Cria post em `pendente_aprovacao` (reaproveita `lib/posts/media.ts` e o mesmo insert de `createPostWithAI`, passando `caption` já pronto — pula geração de manchete/legenda, igual ao acervo do M8), grava `drive_items.post_id`.
  - Daí em diante, fluxo 100% existente: fila de aprovação → agendamento → `publish-scheduled` → Zernio → métricas. Nenhum código de `lib/posts/`, `lib/publishing/`, `lib/acervo/` é alterado por este milestone.

## D6 — Monitor de créditos

- `getBalance()` chamado no início de cada ciclo do `cutpro-pipeline` cron.
- Abaixo de 20% do saldo: insere notificação in-app (mesma tabela `notifications` do M13, migration adicional widening do `check` de `type` para incluir `'saldo_cutpro_baixo'`), com gate de "só uma vez por transição" — precisa de um campo de estado para saber se já alertou desta vez (mais próximo do padrão real do repo: `social_accounts.connection_status` + `consecutive_publish_failures`, não um timestamp) — usar uma coluna simples `cutpro_low_balance_alerted boolean` numa tabela de configuração de integração (ou reaproveitar uma linha única de `templates`/nova tabela `integration_status`), resetada quando o saldo volta a ficar acima do limiar.
- Saldo visível em `/admin/integracoes` (rota já existe — só admin, hoje só mostra o card do Google Drive) — novo card "Cut.Pro" com saldo atual e link pra recarregar.

## Ordem de implementação recomendada

1. **D1** (migration 0019 + `lib/cutpro/` scaffold + `.env.example`) — não depende de nada, testável offline (tipos/compilação).
2. **D2** (`drive_items` mirror + página `/drive` + renomeação do cron) — depende só do D1 (tabela existir).
3. **D3** (legenda por IA) — depende do D2 (precisa da página/item existir), reaproveita 100% pipeline do M4/pivô.
4. **D5** (enviar para aprovação) — pode vir antes do D4 (funciona com o vídeo *original*, sem edição Cut.Pro, desde o início) — deliberadamente adiantado na ordem de implementação em relação ao PLAN.md, porque fecha um caminho ponta a ponta testável (Drive → legenda → aprovação → Zernio) sem depender da API do Cut.Pro/D0.
5. **D4** (edição Cut.Pro real) — maior risco, só valida de ponta a ponta depois do D0 (Victor gerar a chave).
6. **D6** (monitor de créditos) — trivial depois do D4 existir (reaproveita `getBalance()` do client já pronto).

## Fora do escopo (repetido do PLAN.md, não reabrir)

Publicação via Cut.Pro; criação/edição de template via API; customização de legenda por chamada; clipagem de vídeo longo em massa; qualquer mudança em fila de aprovação/agendamento/acervo/publicação.
