# Plano: quadro de renderização (progresso de edição Cut.Pro)

Spec completa: `docs/superpowers/specs/2026-07-21-quadro-renderizacao-design.md`.

## Contexto para todos os subagents

Projeto Next.js/TypeScript/Supabase (Puzzle Records). A edição de vídeo com o template da casa via Cut.Pro (M16/M20) tem uma máquina de estados (`edit_status`: `nao_editado → enviando → clipando → renderizando → editado`, ou `erro`) espelhada em duas tabelas — `drive_items` (fluxo curado do Drive) e `posts` (Post rápido/acervo) — avançada por um cron (`app/api/cron/cutpro-pipeline/route.ts` chamando `lib/cutpro/pipeline.ts`, função `advanceCutProEdit(supabase, table, item)` onde `table` é `"drive_items" | "posts"`).

Hoje o progresso só aparece como texto estático (`EDIT_STATUS_LABEL`, `lib/cutpro/labels.ts`) nos dois cards de UI (`components/drive/drive-item-card.tsx`, `components/kanban/post-card.tsx`). Este plano adiciona progresso real (%), uma trava contra enviar pra aprovação no meio de uma edição, e um painel único listando tudo que está em edição.

**Sem suíte de testes automatizados neste projeto** (sem jest/vitest — confirme rodando `cat package.json` se tiver dúvida). Verificação = `npx tsc --noEmit`, `npm run lint`, `npm run build`, todos devem rodar limpos (os únicos warnings aceitáveis são os 8 já existentes de `<img>` em `lib/renderer/templates/`). Não escreva um framework de testes novo — não é isso que este projeto usa.

## Global Constraints

- **Sem acesso a Postgres direto nesta sessão** (MCP do Supabase desconectado). A migration da Tarefa 1 fica escrita e commitada, mas **não pode ser aplicada durante este plano** — todo código que lê/grava `cutpro_render_progress` deve assumir que a coluna pode não existir ainda em produção e degradar sem quebrar (nunca deixe uma query nova quebrar o carregamento da página inteira por causa dessa coluna).
- Reaproveite os padrões já estabelecidos no código (não invente convenção nova): `EDIT_STATUS_LABEL` já existe em `lib/cutpro/labels.ts`; o padrão de "erro nunca falha em silêncio" (campos `*_error` sempre visíveis) já é usado em `caption_error`/`cutpro_error`/`mirror_error`/`publish_error`.
- Nenhuma mudança no fluxo do Drive curado além do pedido (não mexer em `sendDriveItemToApproval`/`submitForApproval` além da trava especificada na Tarefa 2).
- Nomes de arquivo/pasta seguem o padrão já usado: componentes compartilhados de Cut.Pro ficam em `components/drive/` (onde já está `edit-with-template-button.tsx`) ou `lib/cutpro/` (onde já está `labels.ts`) — não crie uma pasta nova pra isso.
- `content_source !== "acervo"` e `media_type === "video"` são os únicos critérios já usados no projeto pra decidir se algo é vídeo/curado — não introduza um terceiro campo pra isso.

---

## Task 1: Coluna de progresso + pipeline grava o valor real

**Arquivos**: `supabase/migrations/0030_cutpro_render_progress.sql` (novo), `lib/cutpro/pipeline.ts`, `lib/drive/queries.ts` (tipo `DriveItemRow`), `lib/types/post.ts` (tipo `Post`).

1. Crie a migration (não tente aplicá-la — sem acesso a Postgres nesta sessão):
   ```sql
   alter table public.drive_items add column cutpro_render_progress integer;
   alter table public.posts add column cutpro_render_progress integer;
   ```
   Com comentário explicando o motivo (progresso real da API do Cut.Pro, hoje descartado) e citando esta spec.

2. Em `lib/cutpro/pipeline.ts`, função `stepRenderizando`: no branch que já chama `cutpro.getRenderStatus(item.cutpro_render_id)` (quando `item.cutpro_render_id` já existe e o status ainda não é `completed`/`failed`/etc.), acrescente `cutpro_render_progress` no update que já existe pra esse ciclo (ou crie um update dedicado se não houver nenhum nesse branch hoje — leia a função inteira antes de decidir onde encaixar). Verifique se `getRenderStatus` do client (`lib/cutpro/client.ts`/`types.ts`) já retorna um campo de progresso — se não retornar, adicione o campo no tipo de retorno e no client, seguindo o mesmo padrão dos outros campos já mapeados da resposta da API (`status`, `downloadUrl`, etc. — a API real do Cut.Pro devolve um campo `progress` numérico 0–100 na consulta de render, confirmado em teste real de sessão anterior; o nome exato do campo JSON pode ter esse nome ou snake_case equivalente — confira o client existente pra ver a convenção de mapeamento usada nos outros campos).

3. Adicione `cutpro_render_progress: number | null` na interface `CutProEditableRow` (`lib/cutpro/pipeline.ts`), no tipo `DriveItemRow` (`lib/drive/queries.ts`, e no `select()` de `listDriveItems`) e no tipo `Post`/`PostWithRelations` (`lib/types/post.ts` — `listPosts` já usa `select("*")` então não precisa mexer na query).

4. Rode `npx tsc --noEmit`, `npm run lint`, `npm run build` — devem passar limpos.

---

## Task 2: `RenderStatusBadge` compartilhado + trava contra enviar em edição

**Arquivos**: novo componente em `components/drive/` (ex.: `render-status-badge.tsx`, mesma pasta de `edit-with-template-button.tsx`), `components/drive/drive-item-card.tsx`, `components/kanban/post-card.tsx`, `lib/posts/actions.ts` (`submitForApproval`), `lib/drive/sendToApproval.ts` (`sendDriveItemToApproval`).

**Depende da Task 1** só pelo tipo `cutpro_render_progress` estar disponível nos dados que os cards já recebem — não depende da migration estar aplicada (o valor pode vir `null`/`undefined`, trate como "sem % conhecida ainda").

1. **Componente `RenderStatusBadge`**: recebe `editStatus` (o mesmo union type de `EDIT_STATUS_LABEL`), `renderProgress: number | null`, e `updatedAt: string` (pra calcular tempo decorrido). Comportamento:
   - `nao_editado` / `editado` / `erro`: só o rótulo de `EDIT_STATUS_LABEL`, sem barra (comportamento atual, não precisa de componente novo pra isso — mas centralizar aqui simplifica os dois cards).
   - `enviando` / `clipando` / `renderizando`: rótulo + uma barra de progresso simples (`<div>` com largura em % via CSS, `role="progressbar"` com `aria-valuenow`) usando `renderProgress` quando não for `null`; se for `null`, barra indeterminada (largura fixa pequena com animação de pulso, ou simplesmente sem barra e só o rótulo + tempo decorrido — decida o que for mais simples de implementar bem, mas nunca mostre uma barra parada em 0% como se fosse informação real). Tempo decorrido: `"há Xmin"` calculado a partir de `updatedAt` até agora (recalcule no render, não precisa de interval/polling automático).

2. **Wire-up**: troque o uso direto de `EDIT_STATUS_LABEL[...]` em `drive-item-card.tsx` (linha que mostra `` `· ${EDIT_STATUS_LABEL[item.edit_status]}` ``) e em `post-card.tsx` (bloco `{post.media_type === "video" && post.edit_status !== "nao_editado" && (...)}`) pelo novo componente, mantendo o resto do layout dos cards intacto.

3. **Trava de segurança** — dois lugares:
   - `lib/posts/actions.ts`, `submitForApproval`: antes de chamar `updateStatus`, busque `edit_status` do post (ou inclua na condição do próprio update) e retorne/erro-early se estiver em `"enviando"`, `"clipando"` ou `"renderizando"` — mensagem: *"Aguarde a edição com template terminar antes de enviar para aprovação."* Siga o padrão de retorno de erro já usado nessa função/arquivo (`PostFormState` com `{ error }`, ou o padrão mais simples já usado por `submitForApproval` hoje — leia a função atual primeiro).
   - `lib/drive/sendToApproval.ts`, `sendDriveItemToApproval`: mesma trava — se `edit_status` do item estiver em qualquer um desses três valores, retorne `{ error: "Aguarde a edição com template terminar antes de enviar para aprovação." }` antes de criar o post.
   - Nos componentes de UI que renderizam os botões "Enviar para aprovação" (`post-card.tsx`) e o `SendToApprovalButton` (`components/drive/send-to-approval-button.tsx`, se existir uma checagem de condição de exibição lá ou no pai `drive-item-card.tsx`), desabilite ou oculte o botão nesse mesmo estado transitório, consistente com a trava do backend — leia como as outras condições de exibição (`canEditWithTemplate`, `canSubmit`) já são feitas antes de decidir se desabilita ou oculta.

4. Rode `npx tsc --noEmit`, `npm run lint`, `npm run build` — devem passar limpos.

---

## Task 3: Painel "Fila de renderização"

**Arquivos**: nova função de query (ex.: `lib/cutpro/renderQueue.ts`), novo componente (ex.: `components/cutpro/render-queue-panel.tsx` ou junto de outros componentes compartilhados — siga a Global Constraint de nomenclatura acima), `app/(dashboard)/drive/page.tsx`, `app/(dashboard)/aprovacao/page.tsx` (ou onde quer que o board de aprovação seja montado — confira o arquivo real da rota).

**Depende da Task 1** (tipos) e conceitualmente da Task 2 (`RenderStatusBadge`, reaproveite o mesmo componente pra cada linha da fila em vez de duplicar o texto/barra).

1. **Query**: busca, das duas tabelas (`drive_items` e `posts`), todas as linhas com `edit_status` em `("enviando", "clipando", "renderizando")` — campos mínimos: `id`, um nome pra exibir (filename do drive_item, ou headline/caption do post — o que existir), `edit_status`, `cutpro_render_progress`, `updated_at`, e algo que diga de qual tabela/origem veio (pra rotular "Drive" vs "Post rápido/Acervo" na lista). Duas queries simples (uma por tabela) combinadas em memória é suficiente — não precisa de view/RPC nova no banco.

2. **Componente**: lista compacta (não precisa ser uma tabela elaborada) — cada linha usa `RenderStatusBadge` (Task 2) + o nome do item + de onde veio. Se a lista estiver vazia, não renderize nada visível (sem "nenhum item em edição" ocupando espaço à toa) — siga o padrão já usado em `DailySlotsPanel` (`components/calendar/daily-slots-panel.tsx`, retorna `null` cedo quando não há nada a mostrar).

3. **Wire-up**: adicione o painel no topo de `/drive` (`app/(dashboard)/drive/page.tsx`) e de `/aprovacao` (encontre o arquivo de rota real — pode ser `app/(dashboard)/aprovacao/page.tsx` ou nome parecido) — mesmo padrão de composição já usado ao adicionar `DailySlotsPanel` em `/calendario`.

4. Rode `npx tsc --noEmit`, `npm run lint`, `npm run build` — devem passar limpos.

---

## Pronto para avançar quando

Os três testes manuais da spec passam (verificação por leitura de código + os três comandos de build, já que não há suíte automatizada): item em edição mostra progresso real (ou tempo decorrido) nos dois cards; enviar pra aprovação no meio da edição é bloqueado com mensagem clara nos dois pontos de entrada (Drive e Post rápido); o painel de fila lista tudo que está em edição, nas duas telas, e não aparece quando não há nada em edição.
