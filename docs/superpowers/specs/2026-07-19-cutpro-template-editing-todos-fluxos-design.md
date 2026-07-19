# Edição com template (Cut.Pro) padronizada em todos os fluxos de vídeo — design

Data: 2026-07-19

## Contexto

Hoje a edição de vídeo com o template da casa via Cut.Pro (M16) só existe no fluxo curado do Drive (`/drive`): `drive_items` tem as colunas de estado do Cut.Pro (`edit_status`, `cutpro_video_id/submission_id/clip_id/template_id/render_id`, `cutpro_error`, `edited_media_path`) e o cron `cutpro-pipeline` (`lib/cutpro/pipeline.ts`) avança essa máquina de estados a cada 5 min.

Existem dois outros fluxos que criam posts de vídeo direto na tabela `posts`, sem passar por `drive_items`, e sem nenhuma opção de edição com template:

1. **Post rápido / Novo post** (`/aprovacao`, `lib/posts/actions.ts` — `createPostWithAI`/`createPost`).
2. **Cadastro manual de acervo** (dentro de `/drive`, mesmas actions de posts, `content_source: "acervo"`).

Pedido do Victor: padronizar a edição com template pra esses dois fluxos também, com o mesmo comportamento opcional já validado no Drive (aprovado em sessão de brainstorming, 19/07/2026).

## Decisões da sessão de brainstorming

- **Escopo**: Post rápido/Novo post (painel) e cadastro manual de acervo ganham a opção. O fluxo curado do Drive não muda.
- **Obrigatoriedade**: opcional, botão "Editar com template" igual ao Drive — nunca bloqueia "Enviar para aprovação". Consistente com o resto do app e não gasta crédito Cut.Pro em vídeo que a equipe não quer editar.
- **Reuso de arquitetura**: em vez de forçar um fluxo artificial via `drive_items`, as mesmas colunas de estado do Cut.Pro são espelhadas direto em `posts`. A janela de edição é o período em que o post já existe mas ainda está em `status: "rascunho"` (confirmado no código: `createPostWithAI`/cadastro de acervo já criam como `rascunho`, e existe uma ação explícita `submitForApproval` separada da criação — mesma janela temporal que o Drive usa antes do post existir).

## Modelo de dados

Migration nova (`00XX_posts_cutpro_columns.sql`), espelhando exatamente as colunas de `drive_items` (migration `0019`):

```sql
alter table public.posts
  add column edit_status text not null default 'nao_editado'
    check (edit_status in (
      'nao_editado', 'enviando', 'clipando', 'aplicando', 'renderizando',
      'editado', 'erro'
    )),
  add column cutpro_video_id text,
  add column cutpro_submission_id text,
  add column cutpro_clip_id text,
  add column cutpro_template_id text,
  add column cutpro_render_id text,
  add column cutpro_error text,
  add column edited_media_path text;
```

Sem RLS nova — `posts` já tem policy de update para autenticado, mesma usada hoje.

## Pipeline (`lib/cutpro/pipeline.ts`)

A função principal (`advanceDriveItemEdit`) e os passos internos (`stepEnviando`, `stepClipando`, `stepRenderizando`, `finalizeRender`, `markError`) hoje têm `.from("drive_items")` hardcoded em ~9 pontos. Generalizar:

- Renomear `advanceDriveItemEdit` → `advanceCutProEdit(table: "drive_items" | "posts", row)`.
- Cada `.from("drive_items")` interno vira `.from(table)`.
- Campos lidos/gravados são os mesmos nas duas tabelas (mesmo nome de coluna) — nenhuma outra mudança de lógica.
- **Diferença no passo final** (`finalizeRender`): `drive_items` só grava `edited_media_path` (o `rendered_art_url` do post final é resolvido depois, em `sendDriveItemToApproval`, D5). Para `posts`, como o post já existe e já pode estar visível na fila, `finalizeRender` também atualiza `posts.rendered_art_url = edited_media_path` no mesmo update — é esse campo que `publish-scheduled` de fato usa pra publicar (confirmado em `lib/posts/pendingPublish.ts`).

Cron `app/api/cron/cutpro-pipeline/route.ts`: passa a buscar itens elegíveis nas duas tabelas (`drive_items` e `posts`, mesmo filtro de `edit_status not in ('nao_editado', 'editado', 'erro')`) e chamar `advanceCutProEdit` pra cada um, mantendo "um passo por ciclo, retomável" (mesmo comportamento já validado em produção).

## UI

- `components/kanban/post-card.tsx`: novo botão "Editar com template" (reaproveita `EditWithTemplateButton` de `components/drive/`, generalizado pra aceitar `{ table: "posts"; postId: string }` em vez de só `driveItemId`) quando `post.media_type === "video" && post.status === "rascunho" && (post.edit_status === "nao_editado" || post.edit_status === "erro")`.
- Label de status (`EDIT_STATUS_LABEL`, hoje só em `drive-item-card.tsx`) extraído pra um local compartilhado (`lib/cutpro/labels.ts`) e reaproveitado nos dois cards.
- Nova server action `startCutProEditForPost(postId)` em `lib/posts/actions.ts`, espelhando `startCutProEdit` de `lib/drive/actions.ts` (mesma validação: `CUTPRO_HOUSE_TEMPLATE_ID` configurado, update condicional pra travar contra clique duplo).

## Fora de escopo (YAGNI, confirmado na sessão)

- Fluxo do Drive não muda.
- Sem edição em lote pro acervo — um vídeo por vez, mesmo padrão de créditos já em produção.
- Sem seletor de múltiplos templates (mesma decisão já tomada no M16/D4 — só existe o template da casa hoje).
- Não fica obrigatório em nenhum fluxo.

## Testes

- `npx tsc --noEmit`, `npm run lint`, `npm run build` limpos (mesmo padrão de toda a sessão).
- Teste manual: criar um "Post rápido" de vídeo, clicar "Editar com template", confirmar que o cron avança o `edit_status` e que `rendered_art_url` aponta pro vídeo editado ao final — mesmo tipo de validação já feita contra o Drive (créditos reais Cut.Pro, autorização já dada nesta sessão anteriormente para testes desse tipo).

**Pronto para avançar quando**: um vídeo criado via Post rápido ou cadastro de acervo pode ser editado com o template da casa pelo mesmo botão/fluxo do Drive, sem quebrar nenhum comportamento existente.
