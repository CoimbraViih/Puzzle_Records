# M0 — Scaffolding — Design

Data: 2026-07-02
Escopo: [PLAN.md](../../../PLAN.md) — milestone M0.

## Objetivo

Base do projeto pronta para deploy contínuo: Next.js + TypeScript + Tailwind + shadcn/ui,
Supabase conectado, deploy inicial na Vercel, variáveis de ambiente documentadas.

## Decisões (confirmadas com o usuário)

- Código na **raiz do repositório**, junto da documentação existente.
- Gerenciador de pacotes: **npm**.
- Git: inicializar repositório local e conectar ao remoto já criado
  `https://github.com/CoimbraViih/Puzzle_Records.git`. Nenhum push sem confirmação explícita.
- Contas Vercel e Supabase já existem. Login/link via CLI (OAuth) não pode ser completado
  pelo agente nesta sessão — os comandos ficam prontos para o usuário rodar localmente.

## Componentes

1. **App Next.js** — App Router, TypeScript, Tailwind, ESLint. Página inicial "hello world"
   mínima só para validar o pipeline (não é a UI final do painel).
2. **shadcn/ui** — inicializado com tema dark + verde-limão `#96DB12` (identidade Puzzle Records,
   ver `docs/CLAUDE.md`).
3. **Cliente Supabase** — `@supabase/supabase-js` + `@supabase/ssr`, wrapper isolado em
   `lib/supabase/` (client e server), lendo de env vars. Sem lógica de negócio ainda.
4. **Pasta `supabase/`** — `supabase config.toml` local, pronta para migrations no M2. Não cria
   tabelas nesta etapa.
5. **`.env.example`** — todas as chaves necessárias (Supabase URL/anon/service key, OpenAI,
   Zernio, Google Drive, Resend), cada uma comentada com onde obter.
6. **Git** — `git init`, `.gitignore` padrão Next.js, primeiro commit, remote `origin` apontando
   pro GitHub já criado.
7. **Instruções de deploy** — documento curto (`docs/DEPLOY.md`) com os comandos exatos que o
   usuário roda para: `vercel login` + `vercel link`, `supabase login` + `supabase link`,
   configurar env vars no dashboard da Vercel, e conectar o repo GitHub ao projeto Vercel.

## Fora de escopo (fica para milestones seguintes)

- Autenticação/papéis (M1).
- Qualquer tabela de dados real (M2).
- Qualquer chamada real à OpenAI/Zernio/Drive.

## Critério de pronto

App "hello world" acessível em produção na Vercel, com uma verificação simples de conexão ao
Supabase visível na página (ex: status "Supabase: conectado" via `supabase.auth.getSession()`
ou uma query trivial).
