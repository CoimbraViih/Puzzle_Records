# PROJECT ARCHITECTURE: Agente IA Puzzle Records

> Gerado via formulário PRD (NoCodeStartup Framework) em 02/07/2026 — cópia local do documento preenchido.

## 1. CONTEXT & PROBLEM

A Puzzle Records (gravadora do mesmo grupo da Love Funk) precisa crescer o perfil @puzzlerecordss no Instagram replicando o modelo validado do @lovefunkprodutora (4,6M seguidores): perfil de mídia com notícias virais + lançamentos dos artistas, em artes padronizadas estilo "news card".

Hoje o processo é 100% manual: criar arte, escrever manchete e legenda, agendar e publicar 2–3 posts/dia consome horas da equipe e gera inconsistência (dias sem post). Há um grande acervo de conteúdo parado, lançamentos perdem timing e não existe medição centralizada de performance para orientar a estratégia.

## 2. PROPOSED SOLUTION

Sistema web interno que automatiza o pipeline de postagem: a equipe deposita mídia + fato numa pasta do Google Drive; a OpenAI gera manchete e legenda no estilo da casa (guia de estilo documentado — sem hashtags, @mention do artista, fórmulas de manchete); o sistema renderiza a arte "news card" em 2 templates (faixa branca e manchete sobre imagem) com a identidade da Puzzle; o post entra numa fila de aprovação com preview; aprovado, é publicado no Instagram (depois TikTok/YouTube/Facebook) via API do agregador Zernio no horário agendado; as métricas voltam para um dashboard com relatório semanal.

Regra de ouro: nenhum post sai sem aprovação humana. Fase 2: insights de IA sobre performance e sugestão de pautas virais.

## 3. FUNCTIONAL REQUIREMENTS

- Login e Autenticação
- Kanban (fila de aprovação)
- Dashboards
- Multi usuário
- Permissões por usuário
- Calendário
- Notificações
- Relatórios e Exportação
- Integrações (API)
- Upload de Arquivos
- Busca e Filtros

Gerador de artes news card (HTML/CSS → imagem via Puppeteer/Satori) nos 2 templates do guia de estilo; monitoramento de pasta do Google Drive (ingestão automática de mídia + metadados); geração de manchete + legenda via OpenAI (GPT-4o-mini na rotina, GPT-4o em lançamentos, 2–3 variações por post); fila de aprovação com preview fiel por rede (aprovar/editar/rejeitar); agendamento distribuído de 2–3 posts/dia com anti-repetição do acervo; alerta quando a conexão de uma conta social cair (evitar falha silenciosa); biblioteca do acervo com status (novo/agendado/publicado) e link do post final; coleta de métricas por post via API do Zernio.

## 4. USER PERSONAS

Equipe de conteúdo — sobe mídia e fatos no Drive, ajusta manchetes/legendas na fila.

Aprovador (gestor/dono) — revisa o preview, aprova/edita/rejeita cada post, acompanha o dashboard; SLA de aprovação de 4h.

Admin (Victor) — configura contas conectadas, templates, prompts da IA e integrações (Zernio, Drive, OpenAI).

Artista — não usa o sistema; é taggeado nos posts e orientado a comentar para gerar engajamento.

## 5. TECHNICAL STACK

- Next.js · React · TypeScript
- Tailwind CSS · shadcn/ui
- Supabase (PostgreSQL, Auth, Storage)
- Node.js · Vercel (+ Vercel Cron)
- Resend (e-mails de notificação/aprovação)
- Claude Code (desenvolvimento)

OpenAI API (GPT-4o-mini / GPT-4o) para manchetes, legendas e insights; API do Zernio (agregador de redes sociais) para publicação multi-rede — camada de publicação isolada para permitir troca de fornecedor; Google Drive API (ingestão de mídia); Puppeteer ou Satori (render de artes HTML → imagem).

## 6. DESIGN LANGUAGE

@lovefunkprodutora (Instagram) — referência do produto final: news cards estilo Choquei (faixa branca + manchete com emojis + logo redonda sobreposta) e manchete em caixa alta sobre a imagem com rodapé "SIGA @puzzlerecordss".

Identidade Puzzle Records: logo puzzle verde-limão (#96DB12) sobre preto.

Painel: Linear / shadcn dark — limpo, foco em produtividade; fila de aprovação estilo Trello; Buffer/Postiz como referência de UX de agendamento (calendário + preview por rede).

## 7. PROCESS

- Break app build into logical milestones (steps)
- Each milestone should be a deliverable increment
- Prioritize core functionality first, then iterate
- Test each milestone before moving to the next

---

Documentos complementares na mesma pasta:
- `ESPECIFICACAO-AGENTE-PUZZLE-RECORDS.md` — spec completa (fases, custos, riscos)
- `GUIA-DE-ESTILO-POSTS-PUZZLE.md` — guia de estilo dos posts (templates, manchetes, legendas)
- `puzzle-records-logo.svg` — logo vetorizada
