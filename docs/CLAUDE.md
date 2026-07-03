# CLAUDE.md — Agente IA Puzzle Records

Instruções para qualquer sessão do Claude Code trabalhando neste repositório.

## Visão do produto

Painel web interno que automatiza o pipeline de postagem da Puzzle Records: a equipe deposita mídia + fato numa pasta do Google Drive → a OpenAI gera manchete e legenda no estilo da casa → o sistema renderiza a arte "news card" → o post entra numa fila de aprovação com preview → aprovado, é publicado (Instagram primeiro, depois TikTok/YouTube/Facebook) via Zernio no horário agendado → as métricas voltam para um dashboard.

Objetivo de negócio: crescer o @puzzlerecordss replicando o modelo do @lovefunkprodutora (perfil de mídia, não institucional).

## Regra de ouro

**Nenhum post é publicado sem aprovação humana.** Nunca implemente um caminho que publique direto sem passar pela fila de aprovação, mesmo como atalho de teste ou feature flag.

## Workflow de git

Repositório remoto: https://github.com/CoimbraViih/Puzzle_Records (branch `main`).

**Sempre faça `git push` para `origin/main` logo depois de cada commit nessa branch, sem pedir confirmação antes.** Isso vale para commits feitos diretamente pelo Claude e para merges de branches de feature/worktree de volta na `main` — o push final faz parte do fluxo normal, não é uma ação separada que precisa de autorização a cada vez. Só peça confirmação explícita para operações destrutivas de git (force-push, reset --hard em branch compartilhada, deletar branch remota) — essas continuam exigindo confirmação.

## Stack

Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase (Postgres + Auth + Storage), Vercel + Vercel Cron, Resend (e-mails), OpenAI API, API do Zernio (publicação multi-rede), Google Drive API (ingestão), Puppeteer ou Satori (render de artes HTML → imagem).

## Decisões de arquitetura já tomadas

- **Camada de publicação isolada.** Toda chamada ao Zernio passa por uma abstração própria no código — trocar de agregador (plano B: Post Bridge, Postiz) deve ser um ajuste de horas, não um redesenho.
- **Modelos de IA por contexto**: GPT-4o-mini para geração de rotina (custo baixo), GPT-4o para lançamentos importantes. Sempre gerar 2–3 variações de manchete/legenda para o aprovador escolher.
- **Somente 2 templates de arte**: faixa branca (estilo Choquei) e manchete sobre imagem. Não criar templates novos sem pedido explícito — ver `GUIA-DE-ESTILO-POSTS-PUZZLE.md`.
- **Identidade visual**: verde-limão `#96DB12` sobre preto. Painel no estilo Linear/shadcn dark, fila de aprovação estilo Trello, agendamento com referência de UX em Buffer/Postiz.
- **Alertas de conexão**: quando uma conta social desconectar, o sistema deve alertar ativamente — nunca falhar em silêncio (posts perdidos sem aviso é o pior cenário operacional).

## Guia de estilo de conteúdo (resumo executável)

Fonte completa: `../GUIA-DE-ESTILO-POSTS-PUZZLE.md`. Regras que a geração de IA e os templates devem sempre respeitar:

1. **Sem hashtags** — a manchete da arte carrega a informação, não a legenda.
2. Lançamentos sempre com **@mention do artista** + música taggeada.
3. Manchete carrega a informação; legenda carrega o engajamento (pergunta ou opinião de torcida).
4. Emojis funcionais, 2–4 por bloco — nunca em toda palavra.
5. Cada post escolhe: Template A ou B + fórmula de manchete + padrão de legenda (viral × lançamento).

## Personas

- **Equipe de conteúdo** — sobe mídia e fatos no Drive, ajusta manchetes/legendas na fila.
- **Aprovador** (gestor/dono) — aprova/edita/rejeita cada post; SLA de aprovação de 4h.
- **Admin (Victor)** — configura contas, templates, prompts de IA e integrações.
- **Artista** — não usa o sistema; é taggeado e orientado a comentar.

## Riscos a ter em mente durante o desenvolvimento

Lista completa na seção 7 de `../ESPECIFICACAO-AGENTE-PUZZLE-RECORDS.md`. Os mais relevantes para decisões de código:

- Zernio é fornecedor novo → manter a camada de publicação isolada (ver acima).
- Contas sociais desconectam → alertar, nunca falhar em silêncio.
- Moderação de conteúdo musical e direitos de imagem/autorais são zonas cinzentas → a aprovação humana é a proteção; não remover ou enfraquecer essa etapa.
- Volume não é igual a crescimento → o dashboard deve deixar claro o que é conteúdo de volume (acervo) vs. estratégico.

## Documentos-fonte (não duplicar, referenciar)

- `../PRD-AGENTE-IA-PUZZLE-RECORDS.md` — PRD resumido.
- `../ESPECIFICACAO-AGENTE-PUZZLE-RECORDS.md` — especificação completa (fluxo, fases, custos, riscos).
- `../GUIA-DE-ESTILO-POSTS-PUZZLE.md` — guia de estilo de posts (templates, manchetes, legendas).
- `../PLAN.md` — milestones de desenvolvimento do MVP.
