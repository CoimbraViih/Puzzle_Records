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

## M1 — Login e multi-usuário

**Objetivo**: acesso controlado por papel.

- Supabase Auth (login por e-mail).
- Papéis: admin, aprovador, equipe de conteúdo.
- Permissões básicas por papel (quem vê o quê).

**Pronto para avançar quando**: os 3 papéis conseguem logar e são redirecionados/restritos corretamente.

## M2 — Modelo de dados + Kanban manual

**Objetivo**: validar o fluxo de aprovação antes de plugar IA e integrações.

- Tabelas: contas sociais, artistas, posts, templates, status.
- Fila de aprovação em Kanban (colunas por status) com CRUD manual — post criado à mão no painel, sem IA/Drive ainda.
- Aprovar / editar / rejeitar funcionando ponta a ponta.

**Pronto para avançar quando**: um post criado manualmente percorre todo o ciclo de status no Kanban.

## M3 — Ingestão do Google Drive

**Objetivo**: conteúdo entra no sistema sem intervenção manual.

- Monitoramento da pasta acordada via Google Drive API.
- Detecção de arquivo novo + leitura de metadados (artista, música, fato — via nome do arquivo ou .txt junto).
- Post novo entra na fila com status "pendente" (sem manchete/legenda ainda).

**Pronto para avançar quando**: soltar um arquivo na pasta do Drive cria um post pendente no painel em poucos minutos.

## M4 — Geração de manchete/legenda via OpenAI

**Objetivo**: IA escreve no tom da casa.

- Prompt com o guia de estilo (`GUIA-DE-ESTILO-POSTS-PUZZLE.md`): sem hashtags, @mention, fórmulas de manchete.
- GPT-4o-mini para rotina, GPT-4o para lançamentos.
- 2–3 variações geradas por post.

**Pronto para avançar quando**: um post pendente do M3 recebe automaticamente manchete + legenda com variações plausíveis no tom da Puzzle Records.

## M5 — Gerador de news cards

**Objetivo**: arte pronta a partir de mídia + manchete.

- Template A (faixa branca) e Template B (manchete sobre imagem) em HTML/CSS.
- Render para imagem via Puppeteer ou Satori.
- Identidade Puzzle Records aplicada (logo, cor `#96DB12`).

**Pronto para avançar quando**: dado uma foto/vídeo + manchete escolhida, o sistema gera a arte final nos 2 formatos.

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
