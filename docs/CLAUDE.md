# CLAUDE.md — Agente IA Puzzle Records

Instruções para qualquer sessão do Claude Code trabalhando neste repositório.

## Visão do produto

Painel web interno que automatiza o pipeline de postagem da Puzzle Records: conteúdo entra por **dois canais** — a pasta do Google Drive pessoal do usuário (fluxo principal, monitorado por cron) ou **upload direto no painel** (para quando o usuário quer postar algo imediato, sem esperar o cron do Drive) — ver decisão de 10/07/2026 abaixo → para **vídeo**, a IA analisa o próprio conteúdo (frames + transcrição de áudio) e escreve a legenda sozinha; para **imagem**, o contexto (digitado no painel, ou vindo do `.json` do Drive) alimenta a IA, que escreve a legenda com base nele → o sistema renderiza a arte "news card" (hoje só para imagem — vídeo segue o débito conhecido do M5 até o M14) → o post entra numa fila de aprovação com preview → aprovado, é publicado (Instagram primeiro, depois TikTok/YouTube/Facebook) via Zernio no horário agendado → as métricas voltam para um dashboard.

Objetivo de negócio: crescer o @puzzlerecordss replicando o modelo do @lovefunkprodutora (perfil de mídia, não institucional). **Conta única** — não há cadastro de artistas nem multi-conta; todo o conteúdo é institucional da Puzzle Records (ver decisão de 10/07/2026 abaixo).

## Regra de ouro

**Nenhum post é publicado sem aprovação humana.** Nunca implemente um caminho que publique direto sem passar pela fila de aprovação, mesmo como atalho de teste ou feature flag.

## Conta única + Drive simplificado + upload direto + IA multimodal (decisão de sessão de 10/07/2026)

Pivô de arquitetura decidido pelo Victor, a ser implementado como pré-requisito do M11 (ver `PLAN.md`) — **ajusta** o modelo de dados e o fluxo de ingestão descritos nos milestones M2–M4/M8 já implementados:

- **Conta única**: só existe `@puzzlerecordss`. Não há cadastro de artistas — os posts são conteúdo institucional da Puzzle Records, não atribuídos a um artista específico. O modelo de dados de `artists` (M2) e a anti-repetição por artista do acervo (M8, `ACERVO_ARTIST_MIN_GAP_DAYS`) saem do sistema.
- **Google Drive continua sendo o canal principal de ingestão** (M3), mas simplificado: é a pasta pessoal do usuário no Drive (Service Account continua necessária para o cron ler a pasta), e o `.json` de metadado não precisa mais casar artista/conta social (conta é sempre a única cadastrada) — só carrega o contexto (`fato`) e o tipo do post. Para vídeo, o `fato` passa a ser opcional: se ausente, a IA analisa o próprio conteúdo do vídeo em vez de depender do texto.
- **Upload direto no painel** (estende o fluxo manual que já existe desde o M2/`PostFormDialog` e o M8/acervo) continua existindo **como segundo canal**, para quando o usuário quer publicar algo imediato sem esperar o cron do Drive (que roda a cada 5 min):
  - **Vídeo**: o usuário só sobe o arquivo — a IA analisa o próprio conteúdo (frames extraídos via FFmpeg + transcrição de áudio via Whisper, enviados a um prompt de visão do GPT-4o) e escreve a legenda sozinha, sem exigir texto de contexto.
  - **Imagem**: o usuário digita o contexto no upload; a IA escreve a legenda com base nesse texto — mesmo papel do `fato` do Drive, só que digitado direto no painel.
- **Análise de vídeo vale para os dois canais**: um vídeo solto no Drive sem `fato` no `.json` passa pelo mesmo pipeline de frames+transcrição+visão que um vídeo subido direto no painel.
- **Prompts fundamentados em boas práticas de copywriting e social media**: `lib/openai/prompts.ts` deve ser reescrito incorporando as diretrizes das skills do Claude Code `copywriting` e `social` (usadas durante o desenvolvimento para fundamentar a reescrita do prompt). Importante: isso é conhecimento transcrito para o system prompt fixo usado pela chamada da API da OpenAI — **skills não são uma dependência de runtime do app**, não existe integração ao vivo com o sistema de skills do Claude Code.

## Workflow de git

Repositório remoto: https://github.com/CoimbraViih/Puzzle_Records (branch `main`).

**Sempre faça `git push` para `origin/main` logo depois de cada commit nessa branch, sem pedir confirmação antes.** Isso vale para commits feitos diretamente pelo Claude e para merges de branches de feature/worktree de volta na `main` — o push final faz parte do fluxo normal, não é uma ação separada que precisa de autorização a cada vez. Só peça confirmação explícita para operações destrutivas de git (force-push, reset --hard em branch compartilhada, deletar branch remota) — essas continuam exigindo confirmação.

## Stack

Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase (Postgres + Auth + Storage), Vercel + Vercel Cron, OpenAI API (OpenRouter como alternativa gratuita só para teste, ver abaixo), API do Zernio (publicação multi-rede), Google Drive API (ingestão), Puppeteer ou Satori (render de artes HTML → imagem).

**OpenRouter para teste** (`lib/openai/client.ts`): mesmo SDK `openai`, só troca `baseURL`/`apiKey` — se `OPENAI_API_KEY` estiver vazia e `OPENROUTER_API_KEY` preenchida, o sistema usa OpenRouter automaticamente com modelos gratuitos (sufixo `:free`), sem mudar código. `AI_PROVIDER=openai`/`openrouter` força um dos dois. Só para testar o pipeline de geração de copy sem custo — a Puzzle Records segue com GPT-4o-mini/GPT-4o em produção (decisão de modelo por contexto, abaixo).

Sem serviço de e-mail no momento (Resend foi removido em 09/07/2026 — ver decisão abaixo) — alertas de SLA/desconexão/relatório semanal ficam pendentes de um novo canal, a decidir no M11 (`PLAN.md`).

Motor de templates de vídeo (roadmap, M14): Remotion + Whisper + FFmpeg, worker fora da Vercel (Railway). Ver seção de decisões abaixo. **FFmpeg + Whisper foram puxados para mais cedo** (M4/M11) para alimentar a análise multimodal de vídeo na geração de legenda — não esperam o M14, que continua sendo especificamente o motor de *templates renderizados* de vídeo.

## Decisões de arquitetura já tomadas

- **Camada de publicação isolada.** Toda chamada ao Zernio passa por uma abstração própria no código (`lib/publishing/`) — trocar de agregador (plano B: Post Bridge, Postiz) deve ser um ajuste de horas, não um redesenho.
- **API real do Zernio** (auditada E validada com publicação real em 09/07/2026, ver `lib/publishing/zernio.ts`): base `https://zernio.com/api/v1`, auth `Bearer sk_...`. Fluxo de mídia é upload próprio deles (`POST /media/presign` com `filename`+`contentType` obrigatórios → `PUT` na URL retornada → `publicUrl` referenciado em `mediaItems`), não aceita URL externa direta. **Publicação é assíncrona mesmo no Instagram** (não só TikTok): `POST /posts` responde `{post: {_id, status: "processing", platforms}}` sem link ainda — o adapter faz *polling* em `GET /posts/{id}` (até ~30s) até `platforms[].status` virar `"published"` com `platformPostUrl`. `post._id` é guardado em `posts.zernio_post_id` (migration `0011`) — é esse `id`, não o link público (`post_url`), que a API de analytics (`GET /analytics?postId=`) exige depois. TikTok resolve o link publicado via webhook assíncrono (`post.tiktok.url_resolved`, ainda não implementado) — hoje isso vira falha explícita em vez de gravar link vazio. **Idempotência**: `publish()` recebe um callback `onSubmitted` chamado assim que o Zernio aceita o post (antes de saber o resultado final) — `posts.zernio_post_id` é gravado imediatamente. Uma tentativa seguinte que encontre `zernio_post_id` já preenchido usa `resolvePendingPublish()` (só reconsulta o status, nunca resubmete) em vez de `publish()` — evita publicação duplicada se uma execução anterior for interrompida entre a submissão e a resolução do polling.
- **Modelos de IA por contexto**: GPT-4o-mini para geração de rotina (custo baixo), GPT-4o para lançamentos importantes. Sempre gerar 2–3 variações de manchete/legenda para o aprovador escolher.
- **Somente 2 templates de arte (imagem)**: faixa branca (estilo Choquei) e manchete sobre imagem. Não criar templates novos sem pedido explícito — ver `GUIA-DE-ESTILO-POSTS-PUZZLE.md`. (Templates de vídeo têm roadmap próprio — ver M14 abaixo.)
- **Identidade visual**: verde-limão `#96DB12` sobre preto. Painel no estilo Linear/shadcn dark, fila de aprovação estilo Trello, agendamento com referência de UX em Buffer/Postiz.
- **Alertas de conexão**: quando uma conta social desconectar, o sistema deve alertar ativamente — nunca falhar em silêncio (posts perdidos sem aviso é o pior cenário operacional). Canal concreto pendente de decisão (Resend removido — ver abaixo).

## Decisões da sessão de 09/07/2026

- **Zernio validado com publicação real de imagem e vídeo.** O adapter (`lib/publishing/zernio.ts`) foi escrito inicialmente sem documentação real da API (stub best-effort do M7), reescrito contra a doc pública (`docs.zernio.com`) e testado com **5 publicações reais bem-sucedidas no Instagram** (conta de teste `@althorya.ai`, 09/07/2026, incluindo 1 vídeo publicado como Reels) — ver detalhe técnico acima. Achados corrigidos nesse processo: 3 divergências entre a doc pública e o comportamento real (campo `filename` obrigatório no presign, resposta assíncrona de `POST /posts`, bug de código nosso com `??` vs `||` numa env var vazia); o débito de idempotência (`onSubmitted`/`resolvePendingPublish`); e o limite padrão de 1MB dos Server Actions do Next.js (`next.config.ts`, `serverActions.bodySizeLimit: "50mb"`), que travava qualquer upload de vídeo de acervo. Único item restante antes do go-live real: trocar a conta de teste pela oficial `@puzzlerecordss` — deliberadamente deixado como última etapa do projeto (decisão do Victor). A `PublishingProvider` isolada garante que essa troca seja incremental, não um redesenho.
- **Rota Meta própria documentada como plano B**, não implementada agora. Blueprint completo em `../ANATOMIA-TEMPLATES-VIDEO.md` seção 5 — produto "Instagram API with Instagram Login", escopos `instagram_business_basic` + `content_publish` + `manage_insights`, dev mode sem App Review para contas próprias. Acionar essa rota se o Zernio falhar na validação do M12 ou mudar de preço.
- **Motor de templates de vídeo entra no roadmap (M14)**: Remotion + Whisper (timestamps por palavra) + FFmpeg, template "Puzzle v1" configurável por formulário, worker de render fora da Vercel (Railway, função serverless não é o ambiente certo). Referência completa da anatomia (título, estilos de legenda, barra de progresso, retenção, print, música) em `../ANATOMIA-TEMPLATES-VIDEO.md`. Fecha a lacuna deixada em aberto desde o M5 (hoje vídeo grava erro explícito em vez de gerar arte).
- **Repositório de templates de vídeo**: tabela `templates` própria no Supabase (JSON de configuração renderizado pelos componentes Remotion/Satori), não geração via IA nem Canva. Nano Banana/Gemini (Google) não criam templates nem editam vídeo — ficam só como complemento para gerar assets de imagem dentro dos templates (montagens de artista, fundos de news card, thumbnails). Canva Connect API fica como integração futura opcional, só se a operação já usar Canva com plano Enterprise (autofill de brand templates exige esse plano).
- **Resend removido do projeto** (não será usado). `lib/email/*`, os crons `sla-alert`/`weekly-report` e a dependência `resend` foram apagados. Decidir o canal de notificação de reposição é a primeira tarefa do M11 — até lá, desconexão de conta só é visível passivamente no dashboard (`connection_status`), sem alerta ativo.

## Guia de estilo de conteúdo (resumo executável)

Fonte completa: `../GUIA-DE-ESTILO-POSTS-PUZZLE.md`. Regras que a geração de IA e os templates devem sempre respeitar:

1. **Sem hashtags** — a manchete da arte carrega a informação, não a legenda.
2. **@mention/música deixaram de ser obrigatórios** (não há mais cadastro de artista — ver decisão de 10/07/2026 acima). Quando o post menciona um artista de terceiros no conteúdo (notícia/fofoca do cenário funk), citar o nome/@ dele no texto se for do conhecimento da equipe/IA — mas é uma menção editorial pontual, não um campo estruturado do sistema.
3. Manchete carrega a informação; legenda carrega o engajamento (pergunta ou opinião de torcida).
4. Emojis funcionais, 2–4 por bloco — nunca em toda palavra.
5. Cada post escolhe: Template A ou B + fórmula de manchete + padrão de legenda (viral × lançamento).

## Personas

- **Equipe de conteúdo** — sobe vídeo/imagem pela pasta do Drive (fluxo principal) ou direto no painel (post imediato); contexto vem do `.json` do Drive ou é digitado no painel para imagem, vídeo a IA analisa sozinha; ajusta manchetes/legendas na fila.
- **Aprovador** (gestor/dono) — aprova/edita/rejeita cada post; SLA de aprovação de 4h.
- **Admin (Victor)** — configura a conta social, templates, prompts de IA e integrações.

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
- `../ANATOMIA-TEMPLATES-VIDEO.md` — anatomia de templates de vídeo (M14) e blueprint da rota Meta própria (seção 5, plano B do Zernio).
- `../PLAN.md` — milestones de desenvolvimento do MVP e roadmap pós-MVP (M11–M15).
