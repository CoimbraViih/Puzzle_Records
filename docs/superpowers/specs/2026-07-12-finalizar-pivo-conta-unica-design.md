# Design — Finalizar o pivô de arquitetura (conta única + Drive simplificado + upload direto + IA multimodal)

**Data**: 12/07/2026
**Contexto**: `PLAN.md` — seção "Pós-M10 — Pivô de arquitetura", pré-requisito do M11. `docs/CLAUDE.md` — seção "Conta única + Drive simplificado + upload direto + IA multimodal".

## Descoberta que redefine o escopo

Ao brainstormar esse pivô, foi encontrado um worktree local já existente
(`.claude/worktrees/pivo-conta-unica-ia-multimodal`, branch
`worktree-pivo-conta-unica-ia-multimodal`, 20 commits à frente da `main`,
nunca mergeado) implementando **20 dos 22 tasks** de um plano já escrito
(`docs/plans/2026-07-10-pivo-conta-unica-ia-multimodal.md`). `npx tsc --noEmit`,
`npm run lint` e `npm run build` rodam limpos nesse worktree hoje.

Decisão (confirmada com o Victor): **terminar e corrigir esse worktree**, não
replanejar do zero. Esse documento cobre só o que falta.

## O que já está pronto (não mexer)

- Migration `0012_single_account_pivot.sql`: dropa `artists`/`posts.artist_id`,
  libera `content_source = 'painel'`.
- Remoção de toda referência a artista em queries, filtros, Kanban, acervo
  (FIFO puro, sem anti-repetição), analytics, CSV, `/admin/artistas`.
- `lib/drive/metadata.ts` simplificado (`fato` opcional pra vídeo, sem
  `artista`/`conta_social`) + `lib/drive/resolveSocialAccount.ts` (substitui
  o match por handle — usa a única linha de `social_accounts`, avisa sem
  falhar se 0 ou 2+ contas existirem).
- `lib/openai/videoAnalysis.ts`: extração de frames via `ffmpeg-static` +
  transcrição via Whisper API (OpenAI hospedado, não local) — roda dentro da
  própria função serverless da Vercel.
- `lib/openai/prompts.ts` reescrito com técnicas de copywriting/social
  (hook, gap de curiosidade, tom de "áudio de grupo", CTA único) + modo
  multimodal (frames como `image_url` + transcrição).
- `lib/openai/generateCopy.ts`: `generateCopyVariations` aceita
  `{mode: "text"}` (Drive/imagem) ou `{mode: "video"}` (análise multimodal).
- Cron `generate-copy` roteia vídeo pro modo multimodal quando `source_fact`
  está ausente.
- `createPostWithAI` (`lib/posts/actions.ts`) + `QuickPostDialog`
  (`components/kanban/quick-post-dialog.tsx`, botão "Post rápido" ao lado de
  "Novo post" em `/conteudo`): upload direto síncrono — IA gera a legenda na
  própria Server Action, sem esperar cron.

**Decisões confirmadas que mantêm essa forma** (não é regressão, é escopo
deliberadamente menor que o brainstorm original):
- Dois dialogs separados (`PostFormDialog` manual + `QuickPostDialog` com
  IA) — não funde num só.
- Arte de imagem no "Post rápido" continua assíncrona (cron `generate-art`
  de até 5 min, ou botão manual "Gerar arte") — não vira síncrona.

## O que falta (escopo deste plano)

### 1. Bug real: vídeo via "Post rápido" fica travado pra sempre

`createPostWithAI` insere o post com `content_source: "painel"` e
`media_type: "video"` mas **nunca preenche `rendered_art_url`**. `renderArt()`
(M5) lança `ArtRenderError` pra qualquer mídia que não seja imagem — então,
se o cron `generate-art` pegar esse post (tem `headline`+`template`, sem
`rendered_art_url`), grava `art_generation_error` permanente. O gate de
publicação do M7 (`lib/posts/pendingPublish.ts`) exige
`rendered_art_url IS NOT NULL` pra qualquer `content_source` — resultado:
**todo vídeo enviado pelo "Post rápido" nunca é publicável**, contradizendo
o próprio objetivo do pivô.

**Fix**: em `createPostWithAI`, quando `mediaType === "video"`, gravar
`rendered_art_url: mediaPath` no insert (mesmo padrão que `createAcervoPost`
já usa pra vídeo de acervo desde o M8 — o vídeo original é a "arte"). Pra
imagem, `rendered_art_url` continua null (fica pro cron/botão manual, decisão
confirmada acima).

### 2. Polish menor, mesma causa: `template` obrigatório mesmo pra vídeo

Vídeo nunca renderiza arte com template (M5 é só imagem) — pedir "Template
A/B" no formulário pra um vídeo é campo morto que só cria fricção. Tornar
`template` opcional no form (`QuickPostDialog`) e na validação de
`createPostWithAI` quando a mídia selecionada é vídeo; continua obrigatório
pra imagem.

### 3. Task 21 do plano original: atualizar `GUIA-DE-ESTILO-POSTS-PUZZLE.md`

Remover a regra de `@mention` obrigatório de artista em lançamentos,
alinhando com o texto já usado em `docs/CLAUDE.md` (menção vira editorial
pontual, não campo estruturado).

### 4. Task 22 do plano original: verificação final + `PLAN.md`

Rerodar `tsc`/`lint`/`build` depois dos fixes acima (já confirmados limpos
antes dos fixes) e marcar `[x]` os itens cobertos na checklist "Trabalho de
implementação necessário" da seção "Pós-M10 — Pivô de arquitetura" do
`PLAN.md`.

### 5. Revisão de código da branch inteira (nunca revisada como um todo)

Os 20 commits existentes foram revisados task-a-task durante a execução
original (mesmo padrão subagent-driven-development dos milestones
anteriores), mas nunca tiveram uma revisão fresh-eyes da branch completa —
todo milestone anterior do projeto teve pelo menos uma. Rodar antes do
merge, com atenção especial a:
- Migration (`drop table`/`drop column` — irreversível, mas sem dado real em
  produção ainda, ver M11 em `PLAN.md`).
- `resolveSocialAccount` com 0 ou 2+ linhas em `social_accounts` (não deve
  falhar em silêncio).
- Tratamento de erro do pipeline de vídeo (`videoAnalysis.ts`,
  `generateCopy.ts` modo vídeo) — nunca falhar em silêncio, mesmo padrão do
  resto do projeto.
- O fix do item 1 acima (não introduzir regressão no caminho de imagem).

### 6. Merge + push

Mergear `worktree-pivo-conta-unica-ia-multimodal` de volta na `main` e dar
push — regra padrão do `docs/CLAUDE.md` (push automático após commit/merge,
sem pedir confirmação, exceto operação destrutiva — não é o caso).

## Fora de escopo (deliberado)

- Rodar a migration contra um projeto Supabase real — fica pro M11 (ainda
  não há projeto linkado nesta sessão).
- Fundir os dois dialogs de criação de post num só.
- Tornar a arte de imagem síncrona no "Post rápido".
- Qualquer trabalho do M11 em diante (deploy, env vars, checklists manuais).

## Verificação

Sem suíte de testes automatizada no projeto (mesmo padrão do plano
original). `npx tsc --noEmit`, `npm run lint`, `npm run build` ao final —
já confirmados limpos no estado atual do worktree (antes dos fixes desta
sessão); repetir depois dos fixes do item 1–2.
