# Finalizar o pivô de arquitetura (conta única + IA multimodal) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Terminar e mergear o worktree `pivo-conta-unica-ia-multimodal` (20/22 tasks do plano original já feitos, `tsc`/`lint`/`build` limpos): corrigir um bug real que deixa vídeo do "Post rápido" travado pra sempre, fechar os 2 tasks que faltavam do plano original, revisar a branch inteira, e mergear na `main`.

**Architecture:** Todo o trabalho acontece dentro do worktree já existente em `.claude/worktrees/pivo-conta-unica-ia-multimodal` (branch `worktree-pivo-conta-unica-ia-multimodal`) — não criar worktree novo. O fix do bug espelha o padrão que `createAcervoPost` (M8) já usa pra vídeo: `rendered_art_url` recebe o próprio path da mídia, já que a renderização de news card (M5) só existe pra imagem.

**Tech Stack:** Next.js Server Actions, TypeScript. Sem suíte de testes automatizada no projeto (confirmado no plano original) — verificação via `npx tsc --noEmit`, `npm run lint`, `npm run build`.

**Contexto:** ver `docs/superpowers/specs/2026-07-12-finalizar-pivo-conta-unica-design.md` (design aprovado) e `docs/plans/2026-07-10-pivo-conta-unica-ia-multimodal.md` (plano original, Tasks 1–20 já implementadas).

**Diretório de trabalho:** todos os comandos `git`/`npm` abaixo rodam dentro de `.claude/worktrees/pivo-conta-unica-ia-multimodal`, exceto a Task 7 (merge), que roda no repositório principal.

---

## Task 1: Corrigir `createPostWithAI` — vídeo trava pra sempre + template obrigatório sem sentido pra vídeo

**Files:**
- Modify: `lib/posts/actions.ts:98-187` (worktree)

**Problema:** `createPostWithAI` insere posts de vídeo (`content_source: "painel"`) sem nunca preencher `rendered_art_url`. `renderArt()` (M5) lança erro pra qualquer mídia que não seja imagem, e o gate de publicação do M7 exige `rendered_art_url IS NOT NULL` — resultado: todo vídeo enviado pelo "Post rápido" fica preso em `aprovado` pra sempre, nunca publica. O mesmo bug faz o formulário exigir "Template" mesmo pra vídeo, campo que nunca é usado nesse caso.

**Step 1: Ler o estado atual do arquivo**

Confirmar que as linhas batem com o trecho abaixo antes de editar (o arquivo pode ter sido tocado por outra sessão):

```ts
  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const postType = String(formData.get("post_type") ?? "") as PostType;
  const template = String(formData.get("template") ?? "") as PostTemplate;
  const context = String(formData.get("context") ?? "").trim();

  if (!socialAccountId || !postType || !template) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  const mediaType = mediaTypeFromFile(mediaFile);
  if (mediaType === "image" && !context) {
    return { error: "Digite o contexto da imagem para a IA escrever a legenda." };
  }
```

**Step 2: Reordenar a validação — `mediaType` precisa ser conhecido antes de validar `template`**

Substituir o trecho acima por:

```ts
  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const postType = String(formData.get("post_type") ?? "") as PostType;
  const templateRaw = String(formData.get("template") ?? "");
  const context = String(formData.get("context") ?? "").trim();

  if (!socialAccountId || !postType) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  const mediaType = mediaTypeFromFile(mediaFile);

  if (mediaType === "image" && !context) {
    return { error: "Digite o contexto da imagem para a IA escrever a legenda." };
  }
  // Template só se aplica à renderização de news card (M5), que só existe
  // pra imagem — vídeo nunca usa esse campo, ver docs/CLAUDE.md.
  if (mediaType === "image" && !templateRaw) {
    return { error: "Selecione um template para a imagem." };
  }
  const template: PostTemplate | null =
    mediaType === "image" ? (templateRaw as PostTemplate) : null;
```

**Step 3: Gravar `rendered_art_url` pra vídeo no insert**

Localizar o insert (mesmo arquivo, logo abaixo):

```ts
  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    social_account_id: socialAccountId,
    template,
    post_type: postType,
    headline: variations[0].headline,
    caption: variations[0].caption,
    copy_variations: variations,
    media_url: mediaPath,
    media_type: mediaType,
    source_fact: context || null,
    status: "rascunho",
    content_source: "painel",
    created_by: profile.id,
  });
```

Adicionar o campo `rendered_art_url` (mesmo padrão de `createAcervoPost`, M8: pra vídeo, a própria mídia é a "arte"; pra imagem, fica `null` — o cron `generate-art`/botão manual "Gerar arte" continuam responsáveis por preencher, decisão confirmada no design):

```ts
  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    social_account_id: socialAccountId,
    template,
    post_type: postType,
    headline: variations[0].headline,
    caption: variations[0].caption,
    copy_variations: variations,
    media_url: mediaPath,
    media_type: mediaType,
    // Vídeo nunca gera news card (M5 é só imagem) — mesmo padrão do
    // acervo (M8): a própria mídia é a "arte". Sem isso, o post fica
    // travado pra sempre no gate de publicação do M7 (exige
    // rendered_art_url preenchido).
    rendered_art_url: mediaType === "video" ? mediaPath : null,
    source_fact: context || null,
    status: "rascunho",
    content_source: "painel",
    created_by: profile.id,
  });
```

**Step 4: Verificar**

Run (dentro do worktree): `npx tsc --noEmit`
Expected: sem erros novos. Se `PostTemplate` reclamar de `null`, confirmar em `lib/types/post.ts` que `Post.template` já é `PostTemplate | null` (é, desde o M2) — o tipo local `template` só precisa da anotação explícita adicionada no Step 2.

**Step 5: Commit**

```bash
git add lib/posts/actions.ts
git commit -m "fix(pivo): vídeo do Post rápido não trava mais sem rendered_art_url"
```

---

## Task 2: `QuickPostDialog` — não pedir Template quando a mídia é vídeo

**Files:**
- Modify: `components/kanban/quick-post-dialog.tsx:93-143` (worktree)

**Step 1: Ler o bloco atual**

```tsx
              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="quick_template"
                    className="text-sm text-muted-foreground"
                  >
                    Template
                  </label>
                  <select
                    id="quick_template"
                    name="template"
                    required
                    defaultValue=""
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TEMPLATES.map((template) => (
                      <option key={template} value={template}>
                        Template {template}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="quick_post_type"
                    className="text-sm text-muted-foreground"
                  >
                    Tipo
                  </label>
                  <select
                    id="quick_post_type"
                    name="post_type"
                    required
                    defaultValue=""
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {POST_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
```

**Step 2: Esconder o seletor de Template quando `isVideo` for true**

O componente já tem o state `isVideo` (setado no `onChange` do input de mídia, mais abaixo no arquivo). Envolver só o bloco do Template numa renderização condicional — o de "Tipo" continua sempre visível e ocupa a linha sozinho quando o de Template some (é `flex-1` dentro de um `flex`, não precisa de mudança de layout):

```tsx
              <div className="flex gap-4">
                {!isVideo && (
                  <div className="flex flex-1 flex-col gap-1.5">
                    <label
                      htmlFor="quick_template"
                      className="text-sm text-muted-foreground"
                    >
                      Template
                    </label>
                    <select
                      id="quick_template"
                      name="template"
                      required
                      defaultValue=""
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <option value="" disabled>
                        Selecione
                      </option>
                      {POST_TEMPLATES.map((template) => (
                        <option key={template} value={template}>
                          Template {template}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="quick_post_type"
                    className="text-sm text-muted-foreground"
                  >
                    Tipo
                  </label>
                  <select
                    id="quick_post_type"
                    name="post_type"
                    required
                    defaultValue=""
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {POST_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
```

Isso já resolve o `required`: quando o `<select name="template">` não está montado no DOM (mídia é vídeo), o browser não bloqueia o submit por ele estar vazio — bate com a Task 1, que agora só exige `template` quando `mediaType === "image"`.

**Step 3: Verificar**

Run: `npx tsc --noEmit` e `npm run lint`
Expected: sem erros novos.

**Step 4: Commit**

```bash
git add components/kanban/quick-post-dialog.tsx
git commit -m "fix(pivo): esconde campo Template no Post rápido quando a mídia é vídeo"
```

---

## Task 3: Verificação de fase (Fase de correção do bug)

**Step 1:** `npx tsc --noEmit` — zero erros.
**Step 2:** `npm run lint` — zero erros (warnings pré-existentes de `<img>`/`alt` nos templates Satori são esperados, já documentados desde o M5).
**Step 3:** `npm run build` — completa sem erro.

Sem commit nesta task (é só checkpoint, mesmo padrão da Task 13 do plano original).

---

## Task 4: Atualizar `GUIA-DE-ESTILO-POSTS-PUZZLE.md` (Task 21 do plano original)

**Files:**
- Modify: `GUIA-DE-ESTILO-POSTS-PUZZLE.md:55-61` e `:74` (worktree)

**Step 1: Editar a seção "Post de lançamento"**

Trecho atual (linhas 55-61):

```
### Post de lançamento — curto e direto
```
O Talento do Staylon é surreal! 🔥

@mcstaylon                              ← mention do artista
```
+ **música taggeada no post** (recurso nativo do Instagram)
```

Substituir por (alinhado com `docs/CLAUDE.md`, seção "Guia de estilo de conteúdo", item 2 — @mention deixa de ser campo estruturado obrigatório, vira menção editorial pontual quando a IA/equipe conhece o artista citado):

```
### Post de lançamento — curto e direto
```
O Talento do Staylon é surreal! 🔥
```
Sem @mention/música obrigatórios (não há mais cadastro de artista — conta
única `@puzzlerecordss`, ver `docs/CLAUDE.md`). Se o post menciona um
artista de terceiros que a equipe/IA conhece, citar o nome/@ dele no texto
é uma escolha editorial pontual, não um campo estruturado do sistema.
```

**Step 2: Editar a regra 2 do resumo executável**

Trecho atual (linha 74):

```
2. Legendas sem hashtags; lançamentos sempre com @mention e tag de música.
```

Substituir por:

```
2. Legendas sem hashtags; @mention/música em lançamentos são editoriais e
   pontuais, não obrigatórios (sem cadastro de artista, ver docs/CLAUDE.md).
```

**Step 3: Commit**

```bash
git add GUIA-DE-ESTILO-POSTS-PUZZLE.md
git commit -m "docs(pivo): atualiza guia de estilo pra conta unica"
```

(Mesma mensagem de commit já prevista pela Task 21 do plano original.)

---

## Task 5: Verificação final + atualizar `PLAN.md` (Task 22 do plano original)

**Files:**
- Modify: `PLAN.md` (worktree) — seção "Pós-M10 — Pivô de arquitetura: conta única + Drive simplificado + upload direto + IA multimodal (10/07/2026)"

**Step 1:** Rerodar em sequência (repetindo a Task 3 depois dos fixes de docs, mesmo que docs não afete build): `npx tsc --noEmit`, `npm run lint`, `npm run build` — todos limpos.

**Step 2: Marcar a checklist "Trabalho de implementação necessário"**

Localizar em `PLAN.md` (por volta da linha 223-231) o bloco:

```
**Trabalho de implementação necessário** (retrabalho sobre M2–M4/M8, antes de fechar o M11):
- [ ] Migration removendo/desativando `artists` e `artist_id` — decidir na implementação se a coluna é dropada ou só deixada nula/sem uso.
- [ ] Remover `/admin/artistas` e toda referência a artista no Kanban/acervo/calendário/analytics/CSV.
- [ ] Simplificar `lib/drive/metadata.ts`/`matchArtistAndAccount.ts`: remover campos `artista`/`conta_social` do `.json` (conta é sempre a única cadastrada), tornar `fato` opcional para `media_type = 'video'`.
- [ ] Novo formulário de "Novo post" com upload direto (segundo canal) com dois modos: vídeo (sem campo de contexto, dispara análise automática) e imagem (campo de contexto obrigatório).
- [ ] Pipeline de análise de vídeo: extração de frames (FFmpeg) + transcrição (Whisper) + prompt de visão (GPT-4o) → legenda; usado tanto pelo cron `generate-copy` (vídeo do Drive sem `fato`) quanto pelo upload direto; mesmo padrão de erro nunca-silencioso dos milestones anteriores (`copy_generation_error`).
- [ ] `lib/openai/prompts.ts` reescrito com as diretrizes de copywriting/social media.
- [ ] `lib/acervo/scheduler.ts`: remover a anti-repetição por artista (`ACERVO_ARTIST_MIN_GAP_DAYS`) — avaliar se precisa de um substituto (ex.: não repetir a mesma mídia) ou se cai sem substituto.
- [ ] Atualizar `GUIA-DE-ESTILO-POSTS-PUZZLE.md` — a regra de `@mention` obrigatório de artista deixa de ser padrão (vira menção editorial pontual, ver `docs/CLAUDE.md`).
```

Substituir os `[ ]` por `[x]` em todos os 8 itens (todos cobertos: migration dropa a tabela por completo — decisão confirmada no design de 12/07; `matchArtistAndAccount.ts` foi deletado e substituído por `resolveSocialAccount.ts`; upload direto ganhou o dialog "Post rápido" com os dois modos vídeo/imagem, incluindo o fix desta sessão; anti-repetição do acervo caiu sem substituto, decisão confirmada). Adicionar uma linha de nota logo abaixo do bloco, antes de "**Onde isso entra no roadmap**":

```
**Nota (12/07/2026)**: implementado no worktree `pivo-conta-unica-ia-multimodal`
(plano em `docs/plans/2026-07-10-pivo-conta-unica-ia-multimodal.md`, mais o
fix de acabamento em `docs/plans/2026-07-12-finalizar-pivo-conta-unica.md`).
Falta só rodar a migration contra um projeto Supabase real — isso é
trabalho do M11, não deste pivô.
```

**Step 3: Commit**

```bash
git add PLAN.md
git commit -m "docs(pivo): marca checklist do pivo de arquitetura como implementado"
```

(Sem push aqui — o worktree ainda não foi mergeado na `main`, ver Task 7.)

---

## Task 6: Revisão fresh-eyes da branch inteira

A branch tem 20 commits do plano original (cada um já revisado task-a-task
durante a execução, mesmo padrão subagent-driven-development dos milestones
anteriores) + os commits desta sessão (Tasks 1, 2, 4, 5 acima), mas nunca
teve uma revisão de ponta a ponta olhando o diff inteiro contra a `main` —
todo milestone anterior do projeto (M1–M10) teve pelo menos uma.

**Step 1:** Gerar o diff completo da branch pra revisão:

```bash
git diff main...worktree-pivo-conta-unica-ia-multimodal --stat
```

**Step 2:** Revisar o diff inteiro (via subagent `code-reviewer` num modelo mais capaz, mesmo padrão já usado nos milestones M8/M9/M10 do `PLAN.md`), com atenção especial a:

- **Migration** (`supabase/migrations/0012_single_account_pivot.sql`): `drop table`/`drop column` são irreversíveis — confirmar que não há nenhuma FK ou política RLS residual apontando pra `artists` em nenhuma migration anterior que essa migration não cubra.
- **`resolveSocialAccount`** (`lib/drive/resolveSocialAccount.ts`): confirmar que o caso de 0 ou 2+ linhas em `social_accounts` não falha em silêncio (grava `ingestion_warning`, não bloqueia a ingestão) — mesmo padrão que `matchArtistAndAccount` (removido) já seguia.
- **Pipeline de vídeo** (`lib/openai/videoAnalysis.ts`, modo `"video"` de `generateCopy.ts`): toda falha (ffmpeg ausente, transcrição, chamada à OpenAI) precisa terminar em `copy_generation_error` visível no Kanban, nunca em silêncio — mesmo padrão do resto do projeto.
- **O fix da Task 1 desta sessão**: confirmar que o caminho de imagem não regrediu (continua exigindo `context`/`template`, continua com `rendered_art_url: null` esperando o cron/botão manual).
- Achados encontrados: corrigir inline (mesmo fluxo de todas as revisões anteriores do projeto — implementador + revisor por achado, não só listar).

**Step 3:** Depois de qualquer correção, rerodar `npx tsc --noEmit`, `npm run lint`, `npm run build`.

**Step 4:** Se houve correções, commitar (mensagem descrevendo o achado, mesmo padrão de todas as revisões anteriores do projeto). Se a branch já estava limpa, seguir direto pra Task 7 sem commit aqui.

---

## Task 7: Merge na `main` + push

**Executar no repositório principal** (não no worktree — `cd` de volta pra raiz do projeto).

**Step 1:** Confirmar que a `main` não avançou de um jeito que gere conflito:

```bash
git log --oneline main --not worktree-pivo-conta-unica-ia-multimodal
```

Esperado: só commits de documentação/spec desta sessão (sem mudança de código sobrepondo os arquivos tocados pela branch). Se houver mudança de código real em conflito potencial, parar e avisar antes de mergear.

**Step 2:** Merge:

```bash
git checkout main
git merge --no-ff worktree-pivo-conta-unica-ia-multimodal -m "merge: pivô conta única + Drive simplificado + upload direto + IA multimodal

Fecha o pré-requisito do M11 (PLAN.md, seção Pós-M10 — Pivô de
arquitetura). Ver docs/plans/2026-07-10-pivo-conta-unica-ia-multimodal.md
e docs/plans/2026-07-12-finalizar-pivo-conta-unica.md."
```

**Step 3:** Verificar de novo na raiz do projeto (o merge pode ter trazido `package-lock.json`/`next.config.ts` que precisam reinstalar dependências):

```bash
npm install
npx tsc --noEmit
npm run lint
npm run build
```

Expected: tudo limpo.

**Step 4:** Push (regra padrão do `docs/CLAUDE.md` — automático, sem pedir confirmação, já que não é operação destrutiva):

```bash
git push origin main
```

**Step 5:** Limpar o worktree (a branch já está mergeada na `main`, não precisa mais existir separada):

```bash
git worktree unlock ".claude/worktrees/pivo-conta-unica-ia-multimodal"
git worktree remove ".claude/worktrees/pivo-conta-unica-ia-multimodal"
git branch -d worktree-pivo-conta-unica-ia-multimodal
git push origin --delete worktree-pivo-conta-unica-ia-multimodal
```

(Confirmar com o usuário antes deste step especificamente se preferir manter o worktree/branch remota por mais tempo como referência — remover branch remota é o tipo de operação que vale uma checagem rápida, mesmo não sendo destrutiva de dado de produção.)

---

## Notas para quem for executar

- Este plano assume que `main` não recebeu nenhuma mudança de código real
  desde que a branch do pivô foi criada (confirmado nesta sessão: só um
  commit de doc e um par revert/fix que se cancelam) — reconfirmar na
  Task 7 antes de mergear, porque tempo pode ter passado entre escrever e
  executar este plano.
- Rodar a migration `0012_single_account_pivot.sql` contra um projeto
  Supabase real fica fora deste plano — é trabalho do M11 (`PLAN.md`), que
  ainda não tem projeto linkado nesta sessão.
- Sem teste manual de ponta a ponta do pipeline de IA (upload de vídeo real,
  conferir a legenda gerada) neste plano — precisa de `OPENAI_API_KEY`/
  `OPENROUTER_API_KEY` reais e um projeto Supabase linkado, mesma limitação
  que todo o resto do `PLAN.md` já documenta para M1–M10. Fica para o M11.
