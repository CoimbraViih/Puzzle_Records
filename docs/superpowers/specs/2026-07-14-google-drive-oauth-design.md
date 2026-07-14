# Google Drive: troca de Service Account por OAuth Client ID

**Data:** 14/07/2026 · **Responsável:** Victor (decisões) + Claude (implementação)

## Contexto e problema

A ingestão do Drive (M3, `lib/drive/*`) foi implementada e revisada usando uma Service
Account (JWT) para autenticar no Google Drive — ver `lib/drive/client.ts` e
`docs/DEPLOY.md` (seção "Pós-M3"). Na hora de conectar o Drive de verdade, o Victor não
conseguiu criar uma Service Account no projeto do Google Cloud disponível, mas consegue
criar um **OAuth Client ID**. Client ID e Client Secret já gerados (14/07/2026).

Diferença de arquitetura relevante: uma Service Account nunca precisa de interação
humana — a chave sozinha autentica. Um OAuth Client ID depende de um usuário (o Victor)
autorizar o acesso **uma vez**; o resultado dessa autorização (um **refresh token**) é o
que o cron de ingestão (`/api/cron/drive-ingest`, roda a cada 5 minutos sem ninguém
logado) reaproveita para sempre, sem pedir login de novo.

## Decisões já tomadas (sessão de brainstorming, 14/07/2026)

- **Refresh token guardado em env var** (`GOOGLE_OAUTH_REFRESH_TOKEN`), não em tabela do
  Supabase — mesmo padrão manual de copiar-e-colar já usado para
  `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`/`CRON_SECRET` hoje. Reautorizar (ex: se o token for
  revogado) significa repetir o fluxo e colar o novo valor — aceito como suficiente pro
  porte de uma conta única com equipe pequena.
- **Ponto de entrada da autorização única: nova seção em `/admin`** (não uma rota isolada
  sem UI) — combina com o padrão do projeto de configurações de integração ficarem em
  `/admin/*` (`/admin/contas`, `/admin/usuarios`).
- **Tela de consentimento OAuth do Google Cloud precisa estar em modo "Production"**, não
  "Testing" — em "Testing", o Google expira o refresh token em 7 dias
  independentemente de quem autoriza, o que quebraria o cron semanalmente. Ação manual do
  Victor no Google Cloud Console, fora do escopo de código deste spec.
- **Escopo OAuth**: `https://www.googleapis.com/auth/drive` — igual ao que a Service
  Account já usava (precisa de escrita pra mover o arquivo processado pra `Processados/`,
  `lib/drive/folders.ts`/`ingestFile.ts`).
- **Redirect URIs cadastrados no Google Cloud** (múltiplos no mesmo Client ID):
  - `https://puzzle-records-bldm.vercel.app/admin/integracoes/callback` (produção)
  - `http://localhost:3000/admin/integracoes/callback` (dev local)

## Arquitetura

A troca muda só **como conseguimos um cliente autenticado do Drive** — o resto do
pipeline de ingestão (`ingestFile.ts`, `pairFiles.ts`, `resolveSocialAccount.ts`, o cron
`drive-ingest/route.ts`) não muda nada, só consome o cliente já autenticado que
`createDriveClient()` devolve.

### Componentes novos

1. **`app/(dashboard)/admin/integracoes/page.tsx`** — nova página em Administração
   (mesmo grupo de `/admin/contas`), só admin (`requireAdmin()`/`is_admin()`, mesmo
   padrão das demais páginas admin). Mostra se `GOOGLE_OAUTH_REFRESH_TOKEN` está
   configurado (lendo `process.env`, sem chamar a API do Google) e um botão "Conectar
   Google Drive" linkando pra `/api/admin/google-drive/authorize`.
2. **`app/api/admin/google-drive/authorize/route.ts`** — `GET`, admin-only. Monta a URL
   de consentimento do Google via `google.auth.OAuth2` (`googleapis`, já dependência do
   projeto): `client_id`/`client_secret`/`redirect_uri` das env vars,
   `access_type: "offline"`, `prompt: "consent"` (garante que o refresh token sempre
   venha, mesmo em reconexões), `scope: ["https://www.googleapis.com/auth/drive"]`.
   Redireciona (302) pra essa URL.
3. **`app/(dashboard)/admin/integracoes/callback/page.tsx`** — Server Component,
   admin-only, lê `searchParams.code`. Troca o código pelo token
   (`oauth2Client.getToken(code)`) **no servidor** — o refresh token nunca aparece na URL
   do navegador. Renderiza o `refresh_token` retornado num bloco de texto monoespaçado
   com aviso claro ("copie agora, só aparece uma vez") pro Victor colar em
   `GOOGLE_OAUTH_REFRESH_TOKEN` no `.env.local`/env vars da Vercel.
4. **`lib/drive/client.ts`** (reescrito) — troca o JWT da Service Account por
   `new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
   GOOGLE_OAUTH_REDIRECT_URI)` +
   `.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN })`. A lib `googleapis`
   renova o access token sozinha a cada chamada usando o refresh token — nenhum código
   adicional de renovação necessário.

### Env vars

Substituem `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` (sai do projeto por completo — sem suporte
duplo aos dois métodos):
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (a URL do callback — precisa bater exatamente com o
  cadastrado no Google Cloud; local vs. produção são valores diferentes)
- `GOOGLE_OAUTH_REFRESH_TOKEN` (vazia até o Victor completar o fluxo de autorização pela
  primeira vez)

`GOOGLE_DRIVE_FOLDER_ID` continua igual. Como agora é a própria conta do Victor
acessando (não uma Service Account externa), **não precisa mais compartilhar a pasta com
ninguém** — ele já tem acesso.

## Erros / segurança

- `authorize` e a página de `callback` exigem sessão de admin (mesma proteção de
  `/admin/contas`) — reaproveita o helper já usado nas demais rotas/páginas admin do
  projeto.
- `callback`: se `code` estiver ausente na query string, ou a troca por token falhar
  (rejeitada pelo Google, client secret errado, etc.), a página mostra o erro explícito
  — nunca falha em silêncio, mesmo princípio do resto do projeto.
- `createDriveClient()`: se qualquer uma das 4 env vars faltar, lança erro claro
  (mesmo padrão do `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` ausente hoje) — o cron
  `drive-ingest` já trata esse erro como `server_misconfigured` (500), visível nos logs.

## Teste

Manual, mesmo padrão de todos os milestones anteriores (sem projeto de teste
automatizado pra fluxo OAuth real): completar o fluxo (visitar `/admin/integracoes` →
"Conectar Google Drive" → autorizar no Google → copiar o refresh token da tela de
callback → colar no `.env.local` → reiniciar `npm run dev`), depois chamar
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/drive-ingest`
com um arquivo de teste solto na pasta — mesmo teste já documentado em `docs/DEPLOY.md`,
só muda a forma de autenticar.

## Fora de escopo (não faz parte desta mudança)

- Suporte a múltiplas contas Google (conta única, mesma decisão de 10/07/2026).
- Reautorização automática se o refresh token for revogado — hoje exige repetir o fluxo
  manual; um alerta ativo pra esse caso fica pra depois, se virar dor operacional real.
