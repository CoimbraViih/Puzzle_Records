# Quadro de renderização (progresso de edição Cut.Pro) — design

Data: 2026-07-21

## Contexto

Achado ao investigar um post aprovado (M20/M21): o único sinal de progresso da edição com template (Cut.Pro) hoje é uma linha de texto estática (`EDIT_STATUS_LABEL`, ex.: "Renderizando…") em `drive-item-card.tsx` e `post-card.tsx`. Não dá pra saber se está travado, quanto falta, ou se é seguro mandar pra aprovação — e nada impede enviar pra aprovação no meio de uma edição em andamento. A API do Cut.Pro já devolve um campo `progress` (0–100) durante o render (confirmado no teste real da sessão anterior), hoje descartado.

## Decisão

Generalizar a visibilidade de progresso em todo lugar onde a edição com template acontece (Drive e Post rápido/acervo, mesmas duas tabelas do M20: `drive_items` e `posts`), sem criar nada novo do zero — reaproveita a máquina de estados e o pipeline já existentes.

## Mudanças

### 1. Dados
Migration nova: `cutpro_render_progress integer` (nullable, 0–100) em `drive_items` e `posts` — espelha o padrão já usado pelas colunas `cutpro_*` do M20.

**⚠️ Bloqueio conhecido nesta sessão**: o MCP do Supabase está desconectado (precisa reautorizar via `claude mcp`/`/mcp`) — não há acesso a Postgres direto (sem `psql`/CLI configurados). A migration fica escrita e commitada, mas **precisa ser aplicada manualmente** (SQL Editor do Supabase, projeto `dtfnxurjemdabqukgqzc`) antes da % de progresso aparecer de verdade em produção. Até lá, o código deve degradar bem: sem a coluna populada, o quadro mostra o rótulo textual + tempo decorrido, sem barra de %.

### 2. Pipeline (`lib/cutpro/pipeline.ts`)
`stepRenderizando` já consulta `cutpro.getRenderStatus(...)` a cada ciclo enquanto o render roda — passa a gravar `cutpro_render_progress` junto com o resto do update nesse passo, sempre que a API devolver o campo.

### 3. Componente compartilhado `RenderStatusBadge`
Novo componente (`lib/cutpro/` ou `components/cutpro/`, mesma pasta de `labels.ts`) usado nos dois cards (`drive-item-card.tsx`, `post-card.tsx`) no lugar do texto solto de `EDIT_STATUS_LABEL`:
- `nao_editado`/`editado`/`erro`: só o rótulo (comportamento atual).
- `enviando`/`clipando`/`renderizando`: rótulo + barra de progresso (usa `cutpro_render_progress` quando disponível, senão barra indeterminada) + tempo decorrido desde `updated_at`.

### 4. Trava de segurança
`submitForApproval` (`lib/posts/actions.ts`) e `sendDriveItemToApproval` (`lib/drive/sendToApproval.ts`) passam a rejeitar quando `edit_status` está em `enviando`/`clipando`/`renderizando` — mensagem clara ("Aguarde a edição com template terminar antes de enviar."). Os botões correspondentes na UI (`post-card.tsx`, `drive-item-card.tsx`) ficam desabilitados nesse mesmo estado, com o motivo visível.

### 5. Painel "Fila de renderização"
Novo componente + query (lista `drive_items` e `posts` com `edit_status` transitório, das duas tabelas juntas) exibido no topo de `/drive` e `/aprovacao` — visão única de tudo que ainda está "cozinhando", sem precisar caçar item por item.

## Fora de escopo
- Sem notificação push/e-mail ao terminar.
- Sem cancelar uma renderização em andamento (Cut.Pro não expõe isso).

## Plano de execução (subagent-driven-development)

Sem suíte de testes automatizados neste projeto (confirmado nesta sessão — só `tsc --noEmit`/`eslint`/`next build`) — os subagents implementadores verificam com esses três comandos e leitura de código, não escrevem um framework de testes novo.

- **Tarefa 1 — Dados e pipeline**: migration `0030_cutpro_render_progress.sql`; `lib/cutpro/pipeline.ts` grava `cutpro_render_progress`; tipos atualizados (`CutProEditableRow`, `DriveItemRow`, `Post`). Código tolera a coluna ainda não existir em produção (select explícito falharia — por isso a migration deve ser aplicada manualmente antes do deploy final, mas o código já fica pronto).
- **Tarefa 2 — `RenderStatusBadge` + trava de segurança**: componente novo + wire-up nos dois cards; gate em `submitForApproval`/`sendDriveItemToApproval` + desabilitar botões correspondentes.
- **Tarefa 3 — Painel "Fila de renderização"**: query + componente + wire-up em `/drive` e `/aprovacao`.

**Pronto para avançar quando**: os três testes manuais equivalentes passam — item em edição mostra progresso real (ou tempo decorrido) nos dois cards; tentar enviar pra aprovação no meio da edição é bloqueado com mensagem clara; o painel de fila lista tudo que está em edição nas duas telas.
