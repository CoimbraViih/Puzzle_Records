# M0 — Scaffolding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (or superpowers:subagent-driven-development if executing with dispatched subagents).

**Goal:** Base do projeto Agente IA Puzzle Records pronta para deploy contínuo — Next.js + TypeScript + Tailwind + shadcn/ui na raiz do repo, cliente Supabase isolado, deploy manual documentado na Vercel, variáveis de ambiente documentadas.

**Architecture:** App Next.js (App Router) na raiz do repositório. Cliente Supabase isolado em `lib/supabase/` (client-side e server-side separados, seguindo o padrão `@supabase/ssr`). Nenhuma lógica de negócio, autenticação real ou tabela de dados nesta etapa — só a fiação básica e uma página "hello world" que confirma a conexão com o Supabase.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, `@supabase/supabase-js`, `@supabase/ssr`, Supabase CLI, Vercel CLI, npm.

Spec de referência: `docs/superpowers/specs/2026-07-02-m0-scaffolding-design.md`

---

### Task 1: Git init + remote

**Agent:** devops-engineer

**Files:**
- Create: `.gitignore`

**Passos:**
1. `git init`
2. Criar `.gitignore` (padrão Next.js: `node_modules/`, `.next/`, `.env*.local`, `.vercel`, etc. — o próprio `create-next-app` no Task 2 já gera um `.gitignore` adequado; se `git init` rodar antes, só confirmar que ele cobre esses padrões depois do Task 2).
3. `git remote add origin https://github.com/CoimbraViih/Puzzle_Records.git`
4. `git remote -v` para confirmar.

**Verificação:** `git status` mostra repo válido; `git remote -v` lista `origin`.

**Não fazer:** não rodar `git push` nesta tarefa nem em nenhuma tarefa deste plano — push é uma ação que exige confirmação explícita do usuário fora deste plano.

---

### Task 2: Scaffold Next.js

**Agent:** nextjs-architecture-expert

**Files:**
- Cria toda a estrutura padrão do `create-next-app` na raiz (`app/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`, `.eslintrc`/`eslint.config.mjs`, `.gitignore`).

**Passos:**
1. Rodar na raiz do repo (cuidado: a raiz já tem arquivos `.md` e a pasta `.claude/` e `docs/` — usar `create-next-app` apontando para `.` e responder que o diretório não está vazio é esperado):
   ```
   npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
   ```
2. Confirmar que `package.json`, `app/layout.tsx`, `app/page.tsx`, `tailwind.config.ts` (ou config v4 equivalente) foram criados.
3. Rodar `npm run build` para validar que o scaffold builda limpo antes de continuar.

**Verificação:** `npm run build` termina sem erro.

---

### Task 3: shadcn/ui com identidade Puzzle Records

**Agent:** frontend-developer (skill de apoio: `tailwind-patterns`, `senior-frontend`)

**Files:**
- Modify: `app/globals.css` (tokens de cor)
- Create: `components.json` (gerado pelo shadcn CLI)
- Create: `lib/utils.ts` (gerado pelo shadcn CLI)

**Passos:**
1. `npx shadcn@latest init` — escolher estilo "New York" ou "Default", base color neutra, CSS variables habilitado.
2. Ajustar os tokens de cor em `app/globals.css` para tema dark por padrão com verde-limão `#96DB12` como cor primária/accent (ver `docs/CLAUDE.md` — identidade visual).
3. Instalar 1-2 componentes básicos para validar a instalação, ex: `npx shadcn@latest add button`.

**Verificação:** `npm run build` continua passando; `<Button>` renderiza com a cor de destaque correta na página hello-world (Task 6).

---

### Task 4: Cliente Supabase isolado

**Agent:** fullstack-developer (skill de apoio: `supabase`, `supabase-postgres-best-practices`)

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `.env.example`

**Passos:**
1. `npm install @supabase/supabase-js @supabase/ssr`
2. Criar `lib/supabase/client.ts` — browser client via `createBrowserClient` de `@supabase/ssr`, lendo `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Criar `lib/supabase/server.ts` — server client via `createServerClient`, usando cookies do Next.js (App Router), lendo as mesmas env vars públicas (a service role key fica reservada para jobs administrativos futuros, não usada nesta etapa).
4. Criar `.env.example` documentando (com comentário de onde obter cada valor):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (reservada, não usada ainda)
   - `OPENAI_API_KEY`
   - `ZERNIO_API_KEY`
   - `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`
   - `RESEND_API_KEY`

**Verificação:** `npm run build` passa (os clientes não são chamados em build time sem env vars reais, então não deve quebrar o build).

---

### Task 5: Pasta `supabase/` (CLI local)

**Agent:** devops-engineer (skill de apoio: `supabase`)

**Files:**
- Create: `supabase/config.toml` (via CLI)

**Passos:**
1. Confirmar se o Supabase CLI está instalado localmente (`supabase --version`); se não estiver, documentar o comando de instalação em `docs/DEPLOY.md` (Task 7) em vez de instalar globalmente sem permissão.
2. Se disponível: `supabase init` na raiz do repo, gerando `supabase/config.toml` e `supabase/.gitignore`.
3. Não rodar `supabase link` nem `supabase login` — isso fica documentado no Task 7 para o usuário rodar.

**Verificação:** pasta `supabase/` existe com `config.toml`; nenhuma migration criada ainda (fica para M2).

---

### Task 6: Página hello-world com verificação de conexão Supabase

**Agent:** frontend-developer

**Files:**
- Modify: `app/page.tsx`

**Passos:**
1. Página simples: nome do projeto ("Agente IA Puzzle Records"), badge de status "M0 — Scaffolding".
2. Client component que chama `supabase.auth.getSession()` usando o cliente de `lib/supabase/client.ts` e mostra "Supabase: conectado" ou "Supabase: variáveis de ambiente ausentes" (tratamento simples, sem crash se env vars não estiverem configuradas localmente ainda).
3. Usar o `<Button>` do shadcn instalado no Task 3 para validar visualmente o tema.

**Verificação:** `npm run dev` sobe local, página carrega sem erro no console mesmo sem `.env.local` preenchido (deve mostrar o estado "não conectado" graciosamente, não quebrar a página).

---

### Task 7: `docs/DEPLOY.md` — comandos para o usuário rodar

**Agent:** devops-engineer

**Files:**
- Create: `docs/DEPLOY.md`

**Conteúdo exato a incluir:**
1. Instalação de CLIs (se necessário): `npm i -g vercel supabase` (ou via `npx` sem instalar global).
2. Supabase:
   ```
   npx supabase login
   npx supabase link --project-ref <seu-project-ref>
   ```
   Onde achar `<project-ref>`: dashboard do Supabase → Project Settings → General.
3. Vercel:
   ```
   npx vercel login
   npx vercel link
   ```
   Alternativa recomendada para o primeiro deploy: importar o repo `CoimbraViih/Puzzle_Records` direto pelo dashboard da Vercel (vercel.com/new), que já detecta Next.js automaticamente.
4. Configurar env vars no dashboard da Vercel (Project Settings → Environment Variables) usando os mesmos nomes de `.env.example`.
5. Copiar `.env.example` para `.env.local` e preencher com as chaves reais para rodar localmente.

**Verificação:** documento revisado por leitura — nenhum comando executado automaticamente (todos exigem login interativo do usuário).

---

### Task 8: Commit final do M0

**Agent:** devops-engineer

**Passos:**
1. `git add -A`
2. Revisar `git status` — confirmar que `node_modules/`, `.next/`, `.env.local` NÃO estão staged (devem estar no `.gitignore` gerado pelo `create-next-app`).
3. `git commit -m "feat: M0 scaffolding — Next.js + Tailwind + shadcn/ui + Supabase client"`
4. Não fazer push. Informar ao usuário que o commit está pronto localmente e perguntar se deve dar push para `origin`.

**Verificação:** `git log --oneline` mostra o commit; `git status` limpo.

---

## Critério de pronto do M0 (do PLAN.md)

App "hello world" acessível em produção na Vercel, conectado ao Supabase. As Tasks 1–8 entregam tudo que pode ser automatizado pelo agente; o deploy real e o link das contas (Tasks 7) dependem de comandos interativos que o usuário roda seguindo `docs/DEPLOY.md`.
