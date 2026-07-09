# DEPLOY.md — Conectar Vercel e Supabase (M0)

Este documento reúne os comandos que **você** precisa rodar manualmente para linkar
este repositório às contas Vercel e Supabase já existentes. Nenhum desses comandos
foi executado pelo agente — todos exigem login interativo (OAuth no navegador) que
não pode ser completado numa sessão não-interativa.

## 0. Enviar o código para o GitHub

O agente criou todos os commits do M0 localmente, mas **não fez push** — isso exige sua
confirmação. Antes de importar o repositório na Vercel (passo 3), rode:

```bash
git push -u origin master
```

## 1. Instalar as CLIs (opcional)

Não é necessário instalar globalmente — os comandos abaixo usam `npx`, que baixa a
versão mais recente sob demanda. Se preferir instalar globalmente:

```bash
npm i -g vercel supabase
```

## 2. Supabase — login e link

```bash
npx supabase login
npx supabase link --project-ref <seu-project-ref>
```

Onde encontrar o `<project-ref>`: no [dashboard do Supabase](https://supabase.com/dashboard),
abra o projeto → **Project Settings** → **General** → campo "Reference ID".

Isso conecta a pasta `supabase/` (já inicializada neste repo com `supabase init`) ao
seu projeto remoto, permitindo rodar migrations a partir do M2 em diante.

## 3. Vercel — link do projeto

Opção A (recomendada para o primeiro deploy) — importar direto pelo dashboard:

1. Acesse [vercel.com/new](https://vercel.com/new).
2. Importe o repositório `CoimbraViih/Puzzle_Records` do GitHub.
3. A Vercel detecta Next.js automaticamente — não é necessário configurar build command.

Opção B — via CLI:

```bash
npx vercel login
npx vercel link
```

## 4. Configurar variáveis de ambiente na Vercel

No dashboard da Vercel: **Project Settings** → **Environment Variables**.

Adicione cada uma das chaves listadas em [`.env.example`](../.env.example), usando os
mesmos nomes:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (usada pela rota de convite de admin `/api/admin/usuarios` e pelo cron de ingestão `/api/cron/drive-ingest`)
- `NEXT_PUBLIC_SITE_URL`
- `OPENAI_API_KEY`
- `ZERNIO_API_KEY`
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`
- `GOOGLE_DRIVE_FOLDER_ID`
- `CRON_SECRET`

## 5. Rodar localmente

```bash
cp .env.example .env.local
```

Preencha `.env.local` com os valores reais (Supabase URL e anon key você encontra em
**Project Settings** → **API** no dashboard do Supabase). Depois:

```bash
npm run dev
```

A página inicial deve mostrar "Supabase: conectado" quando as chaves estiverem corretas.

## Critério de pronto do M0

App "hello world" acessível em produção na Vercel, conectado ao Supabase — validado
visualmente pelo status de conexão na página inicial.

## Pós-M1: aplicar a migration e criar o primeiro admin

1. Com o projeto já linkado (`npx supabase link --project-ref <seu-project-ref>`,
   passo já documentado acima), aplique a migration:
   ```
   npx supabase db push
   ```
2. Configure `NEXT_PUBLIC_SITE_URL` no `.env.local` e nas env vars da Vercel
   com a URL real do deploy (ex: `https://puzzle-records-agent.vercel.app`).
3. Bootstrap do primeiro admin — como não existe cadastro público, o primeiro
   usuário precisa ser criado manualmente uma única vez:
   - No dashboard do Supabase: **Authentication > Users > Add user**, crie o
     usuário com e-mail e senha.
   - No **SQL Editor**, rode (troque o e-mail):
     ```sql
     update public.profiles set role = 'admin' where email = 'seu-email@puzzlerecords.com';
     ```
   - A partir daí, esse admin consegue convidar os demais usuários direto
     pela tela `/admin/usuarios` do painel.

## Pós-M3: Service Account do Drive e cron de ingestão

1. No [Google Cloud Console](https://console.cloud.google.com), crie (ou reaproveite) um
   projeto, ative a **Google Drive API** e crie uma **Service Account** em
   **IAM & Admin > Service Accounts**.
2. Gere uma chave JSON para essa service account (**Keys > Add Key > JSON**) e baixe o
   arquivo.
3. Compartilhe a pasta do Drive usada para ingestão com o e-mail `client_email` do JSON
   (papel **Editor**).
4. Copie o conteúdo do JSON inteiro, em uma linha só, para `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`
   no `.env.local` e nas env vars da Vercel.
5. Preencha `GOOGLE_DRIVE_FOLDER_ID` com o ID da pasta (parte final da URL do Drive).
6. Gere um valor aleatório para `CRON_SECRET` (ex: `openssl rand -hex 32`) e configure na
   Vercel — isso ativa a proteção automática das chamadas de cron da própria Vercel.
7. Aplique a migration do M3:
   ```
   npx supabase db push
   ```
8. Depois do próximo deploy, o cron `/api/cron/drive-ingest` passa a rodar a cada 5
   minutos automaticamente (agendado em `vercel.json`) — sem nenhum passo manual adicional.
