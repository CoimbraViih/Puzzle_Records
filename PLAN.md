# PLAN.md — Milestones de Desenvolvimento

MVP (Fase 1) do Agente IA Puzzle Records, quebrado em incrementos entregáveis e testáveis. Cada milestone deve ser validado manualmente antes de avançar para o próximo. Contexto completo do produto em [docs/CLAUDE.md](docs/CLAUDE.md) e [PRD-AGENTE-IA-PUZZLE-RECORDS.md](PRD-AGENTE-IA-PUZZLE-RECORDS.md).

**Critério de sucesso do MVP completo**: 2 semanas de operação real com ≥80% dos posts saindo pelo sistema.

---

## M0 — Scaffolding ✅ (código pronto, deploy pendente)

**Objetivo**: base do projeto pronta para deploy contínuo.

- [x] Projeto Next.js + TypeScript + Tailwind + shadcn/ui — dark, identidade verde-limão `#96DB12`.
- [x] Cliente Supabase isolado (`lib/supabase/client.ts` e `server.ts`) e `supabase/config.toml` local.
- [x] Variáveis de ambiente documentadas em `.env.example`: OpenAI, Zernio, Google Drive, Supabase, Resend.
- [ ] Deploy inicial na Vercel e link do projeto Supabase — passos manuais documentados em [docs/DEPLOY.md](docs/DEPLOY.md) (exigem login interativo, não automatizáveis).

**Pronto para avançar quando**: app "hello world" acessível em produção na Vercel, conectado ao Supabase. *(Código commitado e pushado para `main`; falta rodar os passos de `docs/DEPLOY.md` para validar em produção.)*

## M1 — Login e multi-usuário ✅ (código pronto, checklist manual pendente)

**Objetivo**: acesso controlado por papel.

- [x] Supabase Auth (login por e-mail) — login, logout, recuperação e definição de senha.
- [x] Papéis: admin, aprovador, equipe de conteúdo — tabela `profiles` com RLS.
- [x] Permissões básicas por papel (quem vê o quê) — `proxy.ts` redireciona e restringe por papel; convite de usuário via `/admin/usuarios`.
- [x] Revisão de código pós-implementação (8 ângulos: bugs, segurança, duplicação, eficiência) — corrigido: `/api/admin/**` agora tem defesa em profundidade no `proxy.ts` (antes só a rota confiava em `requireAdmin()`), parâmetro `next` do `/auth/confirm` restrito a caminho interno, erros de parse/config tratados na rota de convite em vez de 500 não estruturado.

**Pronto para avançar quando**: os 3 papéis conseguem logar e são redirecionados/restritos corretamente. *(Código commitado na `main`; falta rodar o checklist manual de `docs/plans/2026-07-02-m1-login-multiusuario.md` — Task 12 — contra um projeto Supabase linkado: aplicar a migration, criar o primeiro admin e testar um convite real ponta a ponta.)*

## M2 — Modelo de dados + Kanban manual ✅ (código pronto, checklist manual pendente)

**Objetivo**: validar o fluxo de aprovação antes de plugar IA e integrações.

- [x] Tabelas: `artists`, `social_accounts`, `posts` — com RLS por papel (`equipe_conteudo` só cria/edita os próprios posts em rascunho/rejeitado; `aprovador` só decide posts pendentes; `admin` acesso total). Bucket privado `posts-media` no Supabase Storage.
- [x] Fila de aprovação em Kanban (4 colunas: rascunho/pendente de aprovação/aprovado/rejeitado) com CRUD manual via `PostFormDialog` — post criado à mão no painel com upload real de mídia, sem IA/Drive ainda.
- [x] Aprovar / editar / rejeitar funcionando ponta a ponta, com botões de ação por papel (sem drag-and-drop).
- [x] CRUD de artistas (`/admin/artistas`) e contas sociais (`/admin/contas`), só admin.
- [x] Revisão de código pós-implementação (11 tasks + duas rodadas de revisão final da branch) — corrigido: RLS bloqueava `equipe_conteudo` de editar um post rejeitado sem reenviar (o `WITH CHECK` da política de update só aceitava `rascunho`/`pendente_aprovacao` como status alvo; adicionado `rejeitado`, mantendo `aprovado` de fora para preservar a trava de auto-aprovação); `updatePost`/`rejectPost`/`deletePost`/`submitForApproval`/`approvePost` passaram a detectar quando o RLS bloqueia a escrita silenciosamente (checagem de zero linhas afetadas, com log de erro); `deleteArtist`/`deleteSocialAccount` passaram a logar erros em vez de ignorá-los; 3 erros reais de `npm run lint` corrigidos (`react-hooks/set-state-in-effect` nos modais do Kanban, resolvido com ajuste de estado durante a renderização em vez de `useEffect`).

**Pronto para avançar quando**: um post criado manualmente percorre todo o ciclo de status no Kanban. *(Código commitado na `main`; falta rodar o checklist manual de `docs/plans/2026-07-02-m2-kanban-manual.md` — Task 13 — contra um projeto Supabase linkado: aplicar a migration `0002_content_model.sql`, cadastrar artista/conta social, e testar o ciclo completo de aprovação com os 3 papéis.)*

## M3 — Ingestão do Google Drive ✅ (código pronto, checklist manual pendente)

**Objetivo**: conteúdo entra no sistema sem intervenção manual.

- [x] Monitoramento da pasta acordada via Google Drive API — cron da Vercel a cada 5 minutos (`app/api/cron/drive-ingest`), autenticado via Service Account (`lib/drive/client.ts`).
- [x] Detecção de arquivo novo + leitura de metadados (artista, música, fato, conta social, tipo — via `.json` com o mesmo nome-base da mídia). Sem match de artista/conta social, o post é criado mesmo assim com `ingestion_warning` visível na fila (nunca falha em silêncio).
- [x] Post novo entra na fila com status "pendente" (sem manchete/legenda ainda — `source_fact`/`track_name` guardados para o M4 usar). Arquivos processados são movidos para a subpasta `Processados/` no Drive.

**Pronto para avançar quando**: soltar um arquivo na pasta do Drive cria um post pendente no painel em poucos minutos. *(Código commitado na `main`; falta rodar o checklist manual de `docs/plans/2026-07-03-m3-drive-ingestion.md` — Task 13 — contra uma pasta real do Drive e um projeto Supabase linkado: aplicar a migration `0003_drive_ingestion.sql`, configurar a Service Account e o `CRON_SECRET`, e soltar arquivos reais na pasta.)*

## M4 — Geração de manchete/legenda via OpenAI ✅ (código pronto, checklist manual pendente)

**Objetivo**: IA escreve no tom da casa.

- [x] Cron da Vercel a cada 5 minutos (`app/api/cron/generate-copy`), desacoplado do cron de ingestão do Drive, mesmo padrão de autenticação via `CRON_SECRET` do M3.
- [x] Prompt com o guia de estilo (`GUIA-DE-ESTILO-POSTS-PUZZLE.md`) hardcoded em `lib/openai/prompts.ts`: sem hashtags, @mention, fórmulas de manchete.
- [x] `gpt-4o-mini` para rotina, `gpt-4o` quando `post_type = 'lancamento'` (`lib/openai/generateCopy.ts`).
- [x] 2–3 variações geradas por post, gravadas em `copy_variations` (jsonb); a primeira vira `headline`/`caption`. Picker de variações no card do Kanban (`selectCopyVariation`).
- [x] Falha na geração nunca é silenciosa: `copy_generation_error` gravado no post e visível na fila, mesmo padrão do `ingestion_warning` do M3.
- [x] Revisão de código pós-implementação ([PR #1](https://github.com/CoimbraViih/Puzzle_Records/pull/1)) — corrigido: `selectCopyVariation` não detectava escrita bloqueada pelo RLS (faltava a checagem de zero linhas afetadas usada pelas demais actions desde o M2); `PostPendingCopy.source_fact` estava tipado como `string` não-nulo mascarando a nulidade real da coluna, cron agora grava `copy_generation_error` em vez de chamar a OpenAI com fato ausente; extraída `recordCopyGenerationError()` no cron para logar falha na própria escrita do erro (evita post preso reprocessando em silêncio).

**Pronto para avançar quando**: um post pendente do M3 recebe automaticamente manchete + legenda com variações plausíveis no tom da Puzzle Records. *(Código commitado na `main`; falta rodar o checklist manual de `docs/plans/2026-07-03-m4-copy-openai.md` — Task 11 — contra um projeto Supabase linkado e uma chave `OPENAI_API_KEY` real: aplicar a migration `0004_ai_copy.sql`, rodar o cron contra um post pendente de verdade e testar o caminho de erro. **Limitação conhecida para o M6**: hoje não há, no Kanban, uma ação para mover um post de `pendente` (Drive/IA) para `pendente_aprovacao` — nem o RLS nem a UI cobrem essa transição ainda; o M6 precisa fechar esse elo antes de o fluxo ponta a ponta funcionar.)*

## M5 — Gerador de news cards ✅ (código pronto, checklist manual pendente)

**Objetivo**: arte pronta a partir de mídia + manchete.

- [x] Template A (faixa branca) e Template B (manchete sobre imagem) como árvores JSX compatíveis com Satori (`lib/renderer/templates/templateA.tsx`, `templateB.tsx`), 1080×1350px — dimensão não especificada na documentação-fonte, escolhida por ser o formato retrato do feed do Instagram.
- [x] Render para imagem via Satori + `@resvg/resvg-js` (dupla usada pelo `@vercel/og`), não Puppeteer — decisão explícita por peso/cold-start em função serverless da Vercel (`lib/renderer/renderArt.ts`).
- [x] Identidade Puzzle Records aplicada: logo (`puzzle-records-logo.svg`) embutido como data URI, `#96DB12` usado como acento no rodapé do Template B.
- [x] Cron da Vercel a cada 5 minutos (`app/api/cron/generate-art`), mesmo padrão de `CRON_SECRET` do M3/M4, para posts com `headline`/`template` prontos e sem arte ainda.
- [x] Ação manual "Gerar arte"/"Regenerar arte" no Kanban (`regenerateArt`), para não depender do cron durante testes/edições.
- [x] Falha na geração nunca é silenciosa: `art_generation_error` gravado no post e visível na fila, mesmo padrão do `copy_generation_error` do M4.
- [x] Escopo v1: só posts com `media_type = 'image'`; vídeo grava erro explícito em vez de tentar extrair frame (evita over-engineering sem demanda real).
- [x] Revisão de código pós-implementação (subagent-driven-development, task a task, mais revisão final da branch) — corrigido: fonte "Inter Bold" baixada inicialmente era a fonte variável (peso padrão Regular, não Bold — Satori não reinstancia eixos de fonte variável), substituída pela estática peso 700; `isAuthorized()` do cron `generate-art` falhava aberto quando `CRON_SECRET` não estava definido (comparava contra a string literal `"Bearer undefined"`), corrigido para falhar fechado como o `generate-copy` do M4; `outputFileTracingIncludes` do `next.config.ts` só cobria o cron, faltando as rotas `/conteudo` e `/aprovacao` de onde a ação manual `regenerateArt` também lê fontes/logo (causaria `ENOENT` em produção, invisível em `npm run build` local).
- [x] Revisão independente pós-merge (fresh-eyes, sem contexto das revisões anteriores) — corrigido: o botão "Gerar arte"/"Regenerar arte" era mostrado para qualquer usuário com `headline`/`template` prontos, sem checar permissão (diferente de todos os outros botões do card, que usam `canEdit`/`canDelete`/`canSubmit`/`canDecide` espelhando as políticas de RLS de `posts_update_*`); um content-team clicando num post já em `pendente_aprovacao`, ou um aprovador num `rascunho`, tinha a escrita bloqueada pelo RLS sem feedback visível, além de gastar um render+upload de arte por clique bloqueado — corrigido reaproveitando `canEdit()`, já que `regenerateArt` escreve nas mesmas colunas cobertas pelas mesmas políticas de update que `canEdit` reflete.

**Pronto para avançar quando**: dado uma foto/vídeo + manchete escolhida, o sistema gera a arte final nos 2 formatos. *(Código commitado, revisado e **mergeado na `main`**. `npm run build`, `npx tsc --noEmit` e `npm run lint` rodam limpos (só warnings pré-existentes de `<img>`/`alt` nos templates Satori, que não se aplicam — não são elementos DOM reais). Falta rodar o checklist manual contra um projeto Supabase linkado e mídia/copy reais vindas do M2–M4: aplicar a migration `0005_news_card_render.sql`, chamar o cron contra um post com `headline`/`template` prontos, conferir os dois templates, e testar o caminho de erro (`art_generation_error`) de ponta a ponta. **Débito técnico conhecido, de baixa prioridade** (não bloqueia o M6): arquivos PNG antigos no Storage não são removidos quando uma arte é regenerada (acumula objetos órfãos); se a escrita de `rendered_art_url` falhar após um render bem-sucedido no cron, o erro só é logado no console, não gravado em `art_generation_error`; o cron não tem trava contra sobreposição de execuções caso um lote demore mais de 5 minutos.)*

## UX — Menu de navegação lateral + Dashboard unificado ✅ (código pronto, testado com Playwright/DEMO_MODE local; checklist manual contra Supabase real pendente)

**Objetivo**: dar às páginas autenticadas (`/conteudo`, `/aprovacao`, `/admin/*`) uma navegação lateral compartilhada e um ponto de entrada único de visão geral do projeto, já que cada página tinha seu próprio cabeçalho solto, não havia como transitar entre `/conteudo` e `/aprovacao` sem editar a URL manualmente, e não existia nenhum resumo do estado do pipeline. Melhoria de UX transversal, fora da numeração de milestones do MVP — spec e plano em [docs/superpowers/specs/2026-07-04-sidebar-navegacao-design.md](docs/superpowers/specs/2026-07-04-sidebar-navegacao-design.md) e [docs/plans/2026-07-04-sidebar-navegacao.md](docs/plans/2026-07-04-sidebar-navegacao.md).

- [x] Páginas movidas para o route group `app/(dashboard)/` (sem mudança de URL) com `layout.tsx` compartilhado montando o componente `Sidebar` do shadcn/ui (`style: base-nova`, primitivas `@base-ui/react`).
- [x] Itens de menu agrupados em "Operação" (visão geral/fila de posts/aprovação, todos os papéis com acesso) e "Administração" (admin/artistas/contas/usuários, só admin) — espelha exatamente `roleAllowsRoute()` de `lib/supabase/proxy.ts` (`components/dashboard/nav-items.ts`).
- [x] `AppSidebar` com estado ativo destacado, colapso em ícone-only (com `SidebarRail` clicável no desktop), drawer off-canvas no mobile, e rodapé com nome/papel do usuário + logout — substituindo os botões "Sair" e badges de papel duplicados que existiam em `/conteudo` e `/aprovacao`.
- [x] `PageHeader` compartilhado entre `/conteudo` e `/aprovacao` para cabeçalho consistente; `/admin` mantém seu layout centrado próprio, com escala tipográfica alinhada.
- [x] **Nova rota `/dashboard`**: visão geral com contadores por status de post (pendente/rascunho/pendente de aprovação/aprovado/rejeitado), total de artistas e contas sociais, e atalhos de acesso rápido às páginas que o papel do usuário pode acessar. `ROLE_HOME` unificado — os 3 papéis caem em `/dashboard` após login, em vez de cada um ter sua própria página de entrada; a navegação para as páginas específicas continua pela sidebar. Botão "Começar" da landing page (`/`), que não tinha nenhuma ação, agora leva a `/login`.
- [x] Revisão de design (subagent `ui-ux-designer`, adaptada para revisão de código-fonte já que este sandbox não tem projeto Supabase real linkado para screenshot ao vivo) — corrigido: opacidade do rótulo de grupo (`/50` → `/60`, contraste no limite do WCAG AA), `aria-current="page"` adicionado ao link ativo (sinal não só visual), escala do título de `/admin` alinhada à do `PageHeader`.
- [x] Revisão de código pós-implementação (subagent-driven-development, task a task, mais revisão final da branch) — corrigido: `app/(dashboard)/layout.tsx` sem `dynamic = "force-dynamic"` fazia o build tentar pré-renderizar `/admin/usuarios` estaticamente e falhar por falta de env vars do Supabase (regressão introduzida pelo layout compartilhado); erro de lint `react-hooks/set-state-in-effect` no hook `use-mobile.ts` gerado pelo CLI do shadcn, mesmo padrão de correção já usado no M2; `getCurrentProfile()` passou a ser chamada duas vezes por request (layout + página) sem memoização — envolvida em `cache()` do React; nenhuma forma visível de colapsar a sidebar no desktop (só atalho de teclado Ctrl/Cmd+B) — adicionado `SidebarRail`.
- [x] **Testado ponta a ponta com Playwright** contra build de produção local rodando com dados de exemplo (sem projeto Supabase real — ver nota abaixo): landing page → botão "Começar" → `/login`; `/dashboard` carregando contadores corretos; todos os 7 itens da sidebar navegando para a rota certa; atalhos rápidos do dashboard; modal "Novo post" abrindo em `/conteudo`; `SidebarRail` e colapso no desktop; drawer no mobile. Nesse processo foram corrigidos 2 bugs reais que só apareciam em uso de navegador (não pegos por `tsc`/`build`/lint estático): (1) o botão/link `Button` do shadcn com `render={<Link/>}` precisa de `nativeButton={false}` — sem isso, o Base UI emite aviso de acessibilidade e o elemento renderizado não expõe a semântica de botão corretamente; (2) `id` duplicado no helper `basePost` do scaffold de dados de exemplo (erro de tipos, não afeta produção).

**Débito técnico conhecido, de baixa prioridade** (não bloqueia, comportamento intermitente e que se autocorrige): em cerca de 1 a cada 6–10 carregamentos de `/dashboard`, o React reporta um erro de hidratação (`Sidebar`/`SidebarInset` divergindo entre servidor e cliente) e reconstrói a árvore no cliente — a página continua funcionando normalmente depois disso, e não foi possível reproduzir de forma determinística para isolar a causa raiz durante esta sessão.

**Nota sobre o teste automatizado**: este sandbox não tem projeto Supabase real linkado, então o teste com Playwright rodou com `DEMO_MODE=1` (`.env.local` local, nunca commitado — ver `lib/demo/mockData.ts`, também local e não commitado), que substitui as chamadas de autenticação/dados por um perfil e posts de exemplo fixos. Isso valida toda a navegação, layout e interações de UI, mas **não substitui** o checklist manual contra um projeto Supabase linkado (testar os 3 papéis de verdade, RLS, login real) — mesma limitação de todos os milestones anteriores.

## M6 — Fila de aprovação completa

**Objetivo**: integrar ingestão + IA + arte num fluxo real de aprovação.

- Preview fiel por rede (Instagram primeiro).
- Aprovar / editar (manchete, legenda, arte) / rejeitar.
- Notificações por e-mail (Resend) e alerta de SLA (4h sem aprovação).

**Pronto para avançar quando**: um arquivo solto no Drive vira um post com arte e legenda prontos para revisão, e o aprovador consegue agir sobre ele pelo painel.

## M7 — Publicação via Zernio

**Objetivo**: post aprovado sai do painel e vai ao ar.

- Camada de publicação isolada (abstração sobre o Zernio).
- Agendamento via Vercel Cron.
- Publicação real no Instagram (demais redes depois).

**Pronto para avançar quando**: um post aprovado no painel é publicado automaticamente no horário agendado e o status atualiza para "publicado" com link do post.

## M8 — Fila do acervo

**Objetivo**: manter o perfil ativo com o conteúdo já produzido.

- Biblioteca do acervo com status (novo / agendado / publicado).
- Agendamento distribuído de 2–3 posts/dia com anti-repetição.

**Pronto para avançar quando**: o sistema preenche automaticamente os horários vagos do dia com conteúdo do acervo sem repetir itens recentes.

## M9 — Analytics e alertas de conexão

**Objetivo**: medir performance e evitar falhas silenciosas.

- Coleta periódica de métricas por post via API do Zernio.
- Dashboard comparativo por conta, artista e horário.
- Alerta ativo quando a conexão de uma conta social cair.

**Pronto para avançar quando**: métricas de posts publicados aparecem no dashboard e uma desconexão simulada dispara alerta.

## M10 — Polimento

**Objetivo**: fechar os requisitos funcionais restantes do PRD.

- Busca e filtros na fila/acervo.
- Relatórios e exportação (inclui relatório semanal).
- Calendário visual de posts agendados.
- Revisão geral de notificações.

**Pronto para avançar quando**: todos os requisitos funcionais da seção 3 do PRD estão cobertos e o time consegue operar 100% pelo painel.

---

## Fases seguintes (fora do MVP)

- **Fase 2** — insights de IA sobre performance, sugestão de pautas virais, feedback loop no prompt.
- **Fase 3** — escala interna (10–30 contas de artista), permissões por artista, templates de lançamento.
- **Fase 4** — SaaS multi-tenant (só após Fases 1–3 comprovadas).
