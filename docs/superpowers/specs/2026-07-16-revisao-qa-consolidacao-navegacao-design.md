# Revisão QA + consolidação de navegação — design

Data: 2026-07-16

## Contexto

Revisão completa do painel: caça a bugs, teste end-to-end de todos os fluxos principais (geração de legenda, edição com template Cut.Pro, ações da fila — editar, reenviar, regerar arte, excluir, preview, post rápido, novo post), remoção de duas seções redundantes (Acervo, Fila de Posts) e consolidação das páginas de administração num painel único. Decisões tomadas em sessão de brainstorming (2026-07-16):

- **Tela de testes**: log de execução do QA em tempo real, não uma suíte permanente de CI.
- **Remoção de seções**: completa (apaga código), não só esconder do menu.
- **Acervo**: tem duas funcionalidades sem equivalente no Drive — cadastro manual em massa (upload + legenda direta, sem IA) e agendamento automático de slots diários via cron `acervo-schedule` (`social_accounts.acervo_daily_slots`). Ambas migram para o Drive antes de apagar a página Acervo.
- **Fila de Posts (`/conteudo`) vs Fila de Aprovação (`/aprovacao`)**: renderizam o mesmo board/ações de revisão (`FilterableBoard`) — só diferem nos botões de criação "Novo post" (`PostFormDialog mode="create"`) e "Post rápido" (`QuickPostDialog`, vídeo com IA). Esses dois botões migram para `/aprovacao` antes de apagar `/conteudo`.
- **Admin**: consolidar `/admin`, `/admin/contas`, `/admin/integracoes`, `/admin/usuarios` em uma única página `/admin` com abas.
- **Bugs encontrados durante o QA**: corrigidos na hora, um commit por correção.
- **Ambiente de teste**: local (`npm run dev`), login com `victor-coimbra@hotmail.com`.

## Ordem de execução

A ordem importa: a tela de testes precisa existir antes do QA (para logar nela); as migrações de funcionalidade (Acervo→Drive, botões de criação→Aprovação) precisam existir e estar validadas antes de apagar as páginas de origem; a consolidação do admin é independente e pode rodar em paralelo a qualquer outra frente.

1. Tela de log de testes em tempo real (`/admin` aba "Testes")
2. Consolidação do painel admin em abas (independente, pode rodar em paralelo à 1)
3. Migração Acervo → Drive (cadastro manual + agendamento automático) → depois apagar `/acervo`
4. Migração dos botões de criação de `/conteudo` → `/aprovacao` → depois apagar `/conteudo`
5. QA end-to-end de tudo (usa a tela de testes da etapa 1, roda por último pois testa o estado final do app)

## Componentes

### 1. Tela de log de testes em tempo real

- Nova tabela Supabase `qa_test_runs`: `id, step text, target text, result text check (result in ('ok','fail','info')), detail text, created_at timestamptz default now()`.
- RLS: leitura para qualquer usuário autenticado (mesma política de outras tabelas internas); escrita só via service role (o script de teste roda com a service key, não como usuário logado).
- Nova aba "Testes" dentro de `/admin` (ver seção 2): lista as últimas execuções, ordenadas por `created_at desc`, com Supabase Realtime (`postgres_changes` no canal da tabela) para atualização ao vivo. Cor verde para `ok`, vermelho para `fail`, cinza para `info`.
- Um helper simples `lib/qa/log.ts` com uma função `logTestEvent()` que insere na tabela — usado pelo script/agent de QA, não pelo app em produção normal.

### 2. Consolidação do admin

- `/admin/page.tsx` passa a renderizar um componente de abas (shadcn `Tabs`): Visão geral, Contas sociais, Integrações, Usuários, Testes.
- O conteúdo de cada aba é o componente que já existe em `app/(dashboard)/admin/contas/page.tsx` etc., extraído para um componente reutilizável (ex: `components/admin/contas-tab.tsx`) e importado nas abas — evita duplicar lógica de data-fetching, só muda onde é chamado.
- `/admin/contas`, `/admin/integracoes`, `/admin/usuarios` viram `redirect()` para `/admin?tab=contas` etc. (mantém links antigos/bookmarks funcionando).
- `nav-items.ts`: os itens "Contas sociais", "Integrações", "Usuários" saem do grupo "Administração" — sobra só "Painel admin" apontando para `/admin`.

### 3. Acervo → Drive, depois apagar

- Drive ganha um novo diálogo "Cadastro manual" (reaproveitando UI parecida com `AcervoFormDialog`: upload de mídia + legenda digitada direto, sem IA) que insere post com o mesmo `content_source` que `acervo-schedule` já espera — decisão de implementação: manter o valor `content_source = 'acervo'` internamente (é só um enum de origem no banco, não precisa virar `'drive'`) para não precisar tocar no cron nem na constraint; só a UI de cadastro muda de lugar.
- Configuração de `acervo_daily_slots` (hoje em `/admin/contas`) continua onde está — já é parte do admin consolidado da seção 2, não precisa mover de novo.
- Depois de validar (criar um post via cadastro manual no Drive, confirmar que `acervo-schedule` consegue agendá-lo): apagar `app/(dashboard)/acervo/`, `components/acervo/acervo-board.tsx`, `filterable-acervo-board.tsx` (manter `acervo-form-dialog.tsx`, reaproveitado/movido para `components/drive/`), `lib/acervo/classify.ts` (a exclusão de posts acervo do board de conteúdo deixa de ser necessária — `/conteudo` também está sendo apagado), remover item de nav "Acervo". Manter `lib/acervo/scheduler.ts` e `app/api/cron/acervo-schedule/route.ts` intactos (movidos para `lib/drive/` ou mantidos no lugar, o cron não referencia a página apagada).

### 4. Fila de Posts → Fila de Aprovação, depois apagar

- `/aprovacao/page.tsx` ganha no cabeçalho os dois botões hoje só em `/conteudo`: "Novo post" (`PostFormDialog mode="create"`) e "Post rápido" (`QuickPostDialog`) — mesmo padrão visual dos filtros existentes.
- `/aprovacao` precisa do mesmo `maxDuration = 300` que `/conteudo` tem hoje (por causa do pipeline síncrono de vídeo do post rápido).
- Depois de validar (criar um post manual e um post rápido a partir de `/aprovacao`): apagar `app/(dashboard)/conteudo/page.tsx`, remover item de nav "Fila de posts", limpar `revalidatePath("/conteudo")` órfãos em `lib/posts/actions.ts` e `lib/drive/sendToApproval.ts`.

### 5. QA end-to-end

- Script Playwright (`scripts/qa/*.spec.ts` ou similar, descartável — não precisa virar suíte permanente) que faz login com as credenciais fornecidas contra `npm run dev` local, e para cada fluxo chama `logTestEvent()` antes/depois de cada passo:
  - Geração de legenda (imagem: contexto digitado; vídeo: análise automática de frames+transcrição).
  - Edição com template Cut.Pro.
  - Ações da fila em `/aprovacao`: editar, reenviar, regerar arte, excluir, preview, post rápido, novo post.
  - Fluxos novos das seções 3 e 4 (cadastro manual no Drive, botões movidos para Aprovação).
  - Navegação do admin consolidado (seção 2).
- Bugs encontrados: corrigir na hora, commit por correção, log `fail` seguido de novo teste confirmando o fix (`ok`).

## Riscos e cuidados

- **Não apagar `lib/acervo/scheduler.ts` nem o cron `acervo-schedule`** — só a página/UI antiga. Confirmar que nada mais importa de `lib/acervo/classify.ts`/`actions.ts` antes de apagar (grep final antes do delete).
- **Testes rodam contra `.env.local` real** (Supabase de produção, conforme decisão registrada em `docs/CLAUDE.md`) — ações destrutivas do QA (excluir post, publicar) devem usar dados criados pelo próprio script, nunca posts reais existentes. Confirmar com o usuário antes de qualquer ação que publique de verdade via Zernio (regra de ouro: nenhum post sai sem aprovação humana, e teste automatizado não deve ser tratado como aprovação humana para fins de publicação real).
- Manter a regra de ouro do projeto: em nenhum momento os testes devem publicar um post de teste na conta real `@puzzlerecordss` sem confirmação explícita.
