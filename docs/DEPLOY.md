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
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_REFRESH_TOKEN`
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

## Pós-M3 (atualizado 14/07/2026): OAuth do Drive e cron de ingestão

1. No [Google Cloud Console](https://console.cloud.google.com), crie (ou reaproveite) um
   projeto e ative a **Google Drive API** (**APIs e serviços > Biblioteca**).
2. Em **APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth**, tipo
   **Aplicativo da Web**. Em **Authorized redirect URIs**, cadastre a URL de callback do
   ambiente (local: `http://localhost:3000/admin/integracoes/callback`; produção:
   `https://<seu-domínio>/admin/integracoes/callback` — pode cadastrar as duas no mesmo
   client).
3. Na tela de consentimento OAuth do projeto, deixe o status como **"Production"** (não
   "Testing") — em "Testing" o Google expira o refresh token em 7 dias.
4. Copie o **Client ID** e o **Client Secret** gerados para `GOOGLE_OAUTH_CLIENT_ID` e
   `GOOGLE_OAUTH_CLIENT_SECRET` no `.env.local` e nas env vars da Vercel.
5. Preencha `GOOGLE_OAUTH_REDIRECT_URI` com a mesma URL cadastrada no passo 2 (o valor de
   dev e o de produção são diferentes — cada ambiente usa o seu).
6. Preencha `GOOGLE_DRIVE_FOLDER_ID` com o ID da pasta (parte final da URL do Drive) —
   como agora é a sua própria conta Google acessando, não precisa mais compartilhar a
   pasta com ninguém.
7. Faça login no painel como admin, acesse **Administração > Integrações**
   (`/admin/integracoes`) e clique em **Conectar Google Drive** — autorize no Google.
8. A página de retorno mostra o **refresh token** uma única vez — copie e cole em
   `GOOGLE_OAUTH_REFRESH_TOKEN` no `.env.local`/env vars da Vercel, depois faça um novo
   deploy (ou reinicie `npm run dev` localmente).
9. Gere um valor aleatório para `CRON_SECRET` (ex: `openssl rand -hex 32`) e configure na
   Vercel — é o mesmo valor usado pelo GitHub Actions pra autenticar as chamadas às
   rotas de cron (ver seção de agendamento mais abaixo).
10. Aplique a migration do M3, se ainda não aplicada:
    ```
    npx supabase db push
    ```

## Pós-M11 (14/07/2026): agendamento via GitHub Actions, não Vercel Cron

O plano Hobby da Vercel só permite 2 cron jobs por projeto (máx. 1x/dia) — insuficiente
para as 8 rotas `/api/cron/*` do projeto. `vercel.json` não declara `crons`; um workflow
agendado (`.github/workflows/cron-trigger.yml`) chama essas rotas via HTTP a cada 5
minutos (e as de 30 min, dentro do mesmo workflow). Para ativar:

1. No GitHub, **Settings → Secrets and variables → Actions** do repositório:
   - Aba **Secrets** → **New repository secret** → nome `CRON_SECRET`, valor igual ao
     `CRON_SECRET` que você configurou na Vercel anteriormente.
   - Aba **Variables** → **New repository variable** → nome `SITE_URL`, valor a URL de
     produção do deploy (ex: `https://puzzle-records.vercel.app`, sem barra no final).
2. O workflow já está no repo e ativa sozinho a partir do primeiro push na `main` — não
   precisa rodar nada manualmente. Pra testar sem esperar o agendamento, vá em **Actions →
   Disparar crons do painel → Run workflow**.
3. **Limite aceito por ora**: o Hobby também limita funções a 60s de execução (Pro permite
   até 300s). `generate-copy`/`generate-video-art` processam vídeo com Whisper e podem
   estourar esse teto em clipes maiores — ver `docs/CLAUDE.md` e `PLAN.md` (M11). Migrar
   pra Pro (~US$20/mês) remove os dois limites (crons e duração) de uma vez, se virar dor
   operacional real.
