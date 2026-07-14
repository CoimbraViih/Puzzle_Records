# Google Drive OAuth (troca de Service Account) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Trocar a autenticação do Google Drive de Service Account (JWT) por OAuth 2.0
Client ID, com uma tela em `/admin/integracoes` para o admin autorizar uma vez e obter o
refresh token que o cron de ingestão vai reaproveitar para sempre.

**Architecture:** `lib/drive/client.ts` passa a montar um `google.auth.OAuth2` (client
id/secret/redirect da env) com `setCredentials({ refresh_token })` em vez do JWT da
Service Account — o resto do pipeline de ingestão (`ingestFile.ts`, `pairFiles.ts`,
`resolveSocialAccount.ts`, cron `drive-ingest`) não muda. Duas rotas novas fazem o fluxo
de autorização única: `GET /api/admin/google-drive/authorize` monta a URL de consentimento
do Google e redireciona; `GET /admin/integracoes/callback` troca o `code` pelo refresh
token no servidor e mostra na tela pro admin copiar manualmente pra env var (mesmo padrão
de secrets colados à mão já usado no projeto). Ambas admin-only (middleware já protege
`/admin/**` e `/api/admin/**` por prefixo de path — `lib/supabase/proxy.ts` — mas a rota
sensível ganha `requireAdmin()` como defesa em profundidade, mesmo padrão de
`app/api/admin/usuarios/route.ts`).

**Tech Stack:** Next.js App Router, TypeScript, `googleapis` (já dependência do
projeto), Supabase Auth (via `getCurrentProfile()`).

**Spec de referência:** `docs/superpowers/specs/2026-07-14-google-drive-oauth-design.md`

---

### Task 1: Reescrever `lib/drive/client.ts` para OAuth2

**Files:**
- Modify: `lib/drive/client.ts`

**Step 1: Ler o arquivo atual**

Confirmar o conteúdo atual antes de editar (deve bater com isto):

```ts
import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

export function createDriveClient(): drive_v3.Drive {
  const rawKey = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error(
      "Missing GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable."
    );
  }

  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(rawKey);
  } catch {
    throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY não é um JSON válido.");
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
  });

  return google.drive({ version: "v3", auth });
}
```

**Step 2: Substituir pelo conteúdo OAuth2**

```ts
import { google, drive_v3 } from "googleapis";

export const DRIVE_OAUTH_SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * Monta o cliente OAuth2 do Google (client id/secret/redirect da env), usado
 * tanto pra gerar a URL de consentimento (lib/drive/oauth.ts) quanto, aqui,
 * pra autenticar as chamadas de Drive com o refresh token já obtido.
 */
export function createOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Faltam GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_OAUTH_REDIRECT_URI."
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Autentica no Google Drive via OAuth2 (troca da Service Account — ver
 * docs/superpowers/specs/2026-07-14-google-drive-oauth-design.md). O
 * refresh token é obtido uma única vez pelo admin em /admin/integracoes e
 * reaproveitado para sempre pelo cron de ingestão; a lib googleapis renova
 * o access token sozinha a cada chamada.
 */
export function createDriveClient(): drive_v3.Drive {
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("Missing GOOGLE_OAUTH_REFRESH_TOKEN environment variable.");
  }

  const auth = createOAuth2Client();
  auth.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: "v3", auth });
}
```

**Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `lib/drive/client.ts` (o arquivo ainda não é
importado em lugar nenhum que quebre — `createDriveClient()` mantém a mesma assinatura de
retorno `drive_v3.Drive`, então `app/api/cron/drive-ingest/route.ts` continua
funcionando sem mudança).

**Step 4: Commit**

```bash
git add lib/drive/client.ts
git commit -m "feat(drive): troca Service Account por OAuth2 em lib/drive/client.ts"
```

---

### Task 2: Rota que inicia o fluxo de autorização

**Files:**
- Create: `app/api/admin/google-drive/authorize/route.ts`

**Step 1: Escrever a rota**

```ts
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createOAuth2Client, DRIVE_OAUTH_SCOPES } from "@/lib/drive/client";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

/**
 * Inicia o fluxo de autorização OAuth do Google Drive — só admin. Redireciona
 * pra tela de consentimento do Google; o retorno cai em
 * /admin/integracoes/callback (GOOGLE_OAUTH_REDIRECT_URI).
 * access_type=offline + prompt=consent garantem que o Google sempre devolva
 * um refresh_token, mesmo numa reconexão.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  let authUrl: string;
  try {
    const oauth2Client = createOAuth2Client();
    authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: DRIVE_OAUTH_SCOPES,
    });
  } catch (err) {
    console.error("Falha ao montar a URL de autorização do Google Drive:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  return NextResponse.redirect(authUrl);
}
```

**Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. Se `createOAuth2Client`/`DRIVE_OAUTH_SCOPES` não estiverem
exportados de `lib/drive/client.ts`, revisar a Task 1 (devem ter ficado como
`export function`/`export const` lá).

**Step 3: Commit**

```bash
git add app/api/admin/google-drive/authorize/route.ts
git commit -m "feat(drive): rota que inicia o fluxo de autorização OAuth do Drive"
```

---

### Task 3: Página de callback (troca o code pelo refresh token)

**Files:**
- Create: `app/(dashboard)/admin/integracoes/callback/page.tsx`

**Step 1: Escrever a página**

Server Component — recebe `?code=` do Google via `searchParams`, troca pelo token no
servidor (nunca expõe na URL do navegador) e mostra o `refresh_token` numa caixa de texto
monoespaçada, com aviso de que só aparece uma vez. Segue o padrão visual de
`PageHeader` + `px-6 py-10 md:px-8` usado pelas demais páginas do dashboard.

```tsx
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createOAuth2Client } from "@/lib/drive/client";
import { PageHeader } from "@/components/dashboard/page-header";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

export default async function GoogleDriveCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const admin = await requireAdmin();
  const { code, error: googleError } = await searchParams;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader title="Conectar Google Drive" />

      {!admin && (
        <p className="text-sm text-destructive">
          Só administradores podem completar essa autorização.
        </p>
      )}

      {admin && googleError && (
        <p className="text-sm text-destructive">
          O Google recusou a autorização: {googleError}
        </p>
      )}

      {admin && !googleError && !code && (
        <p className="text-sm text-destructive">
          Código de autorização ausente na URL de retorno do Google.
        </p>
      )}

      {admin && !googleError && code && <ExchangeResult code={code} />}
    </div>
  );
}

async function ExchangeResult({ code }: { code: string }) {
  let refreshToken: string | null | undefined;
  let exchangeError: string | null = null;

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    refreshToken = tokens.refresh_token;
  } catch (err) {
    exchangeError =
      err instanceof Error ? err.message : "Falha desconhecida ao trocar o código.";
  }

  if (exchangeError) {
    return <p className="text-sm text-destructive">Falha ao trocar o código: {exchangeError}</p>;
  }

  if (!refreshToken) {
    return (
      <p className="text-sm text-destructive">
        O Google não devolveu um refresh token dessa vez — normalmente acontece se a
        autorização já tinha sido concedida antes sem revogar o acesso. Revogue o acesso
        do app em myaccount.google.com/permissions e tente de novo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Copie o valor abaixo agora — ele só aparece uma vez. Cole em
        <code className="mx-1 rounded bg-muted px-1 py-0.5">GOOGLE_OAUTH_REFRESH_TOKEN</code>
        no <code className="rounded bg-muted px-1 py-0.5">.env.local</code> e nas env vars
        da Vercel, depois faça um novo deploy.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
        {refreshToken}
      </pre>
    </div>
  );
}
```

**Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add "app/(dashboard)/admin/integracoes/callback/page.tsx"
git commit -m "feat(drive): pagina de callback que troca o code pelo refresh token"
```

---

### Task 4: Página `/admin/integracoes` + item na sidebar

**Files:**
- Create: `app/(dashboard)/admin/integracoes/page.tsx`
- Modify: `components/dashboard/nav-items.ts`

**Step 1: Escrever a página**

Mesmo padrão de layout de `app/(dashboard)/admin/contas/page.tsx` (`PageHeader` +
`px-6 py-10 md:px-8`). Lê `GOOGLE_OAUTH_REFRESH_TOKEN` de `process.env` (só pra saber se
está vazia ou não — nunca exibe o valor) pra mostrar o status.

```tsx
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function IntegracoesPage() {
  const isConnected = Boolean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader title="Integrações" description="Conexões externas do painel." />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-foreground">Google Drive</h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? "Conectado — GOOGLE_OAUTH_REFRESH_TOKEN configurado."
                : "Não conectado — GOOGLE_OAUTH_REFRESH_TOKEN ausente."}
            </p>
          </div>
          <Button render={<a href="/api/admin/google-drive/authorize" />}>
            {isConnected ? "Reconectar" : "Conectar Google Drive"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Verificar antes de fechar a task: `components/ui/button.tsx` — confirmar que `Button`
aceita `render` (mesmo padrão já usado em `DialogTrigger`/`SheetTrigger` no restante do
projeto) pra renderizar como link `<a>` em vez de `<button>`.

**Step 2: Adicionar o item na sidebar**

Em `components/dashboard/nav-items.ts`:
- Importar o ícone `Plug` de `lucide-react` (junto com os demais imports já existentes).
- Adicionar ao array `items` do grupo `"Administração"`, depois de `"Contas sociais"`:

```ts
{
  title: "Integrações",
  url: "/admin/integracoes",
  icon: Plug,
  roles: ["admin"],
},
```

**Step 3: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros novos (os únicos warnings esperados são os pré-existentes de
`<img>`/`alt` em `lib/renderer/templates/*`, documentados no `PLAN.md`).

**Step 4: Commit**

```bash
git add "app/(dashboard)/admin/integracoes/page.tsx" components/dashboard/nav-items.ts
git commit -m "feat(drive): pagina /admin/integracoes + item na sidebar"
```

---

### Task 5: Atualizar `.env.example`, `docs/DEPLOY.md` e `docs/CLAUDE.md`

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Modify: `docs/CLAUDE.md`

**Step 1: `.env.example`**

Trocar o bloco:

```
# Google Drive API — Service Account (Google Cloud Console > IAM & Admin >
# Service Accounts > criar chave JSON). Compartilhe a pasta de ingestão com
# o e-mail "client_email" da service account, papel "Editor".
# Cole o conteúdo do JSON inteiro, numa linha só (sem quebras de linha).
GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY=
# ID da pasta do Google Drive usada pelo agente (parte final da URL da pasta)
GOOGLE_DRIVE_FOLDER_ID=
```

por:

```
# Google Drive API — OAuth 2.0 Client ID (Google Cloud Console > APIs e
# serviços > Credenciais > Criar credenciais > ID do cliente OAuth, tipo
# "Web application"). GOOGLE_OAUTH_REDIRECT_URI precisa bater exatamente com
# uma das "Authorized redirect URIs" cadastradas no client
# (http://localhost:3000/admin/integracoes/callback em dev).
# GOOGLE_OAUTH_REFRESH_TOKEN fica vazia até você completar o fluxo em
# /admin/integracoes (só admin) — a tela mostra o valor uma única vez.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/admin/integracoes/callback
GOOGLE_OAUTH_REFRESH_TOKEN=
# ID da pasta do Google Drive usada pelo agente (parte final da URL da pasta)
GOOGLE_DRIVE_FOLDER_ID=
```

**Step 2: `docs/DEPLOY.md`**

Na seção "## Pós-M3: Service Account do Drive e cron de ingestão", substituir os passos
1–4 (criação da Service Account, chave JSON, compartilhamento de pasta) pelo fluxo OAuth:

```markdown
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
```

Remover/ajustar qualquer menção residual a "Service Account" nessa seção do arquivo.

**Step 3: `docs/CLAUDE.md`**

Buscar por "Service Account" no arquivo e revisar a frase da seção "Google Drive
continua sendo o canal principal de ingestão" (decisão de 10/07/2026) que hoje diz
algo como "Service Account continua necessária para o cron ler a pasta" — trocar por uma
frase equivalente citando OAuth em vez de Service Account, referenciando
`docs/superpowers/specs/2026-07-14-google-drive-oauth-design.md` pra detalhe completo.

**Step 4: Commit**

```bash
git add .env.example docs/DEPLOY.md docs/CLAUDE.md
git commit -m "docs(drive): atualiza .env.example/DEPLOY.md/CLAUDE.md pro fluxo OAuth"
```

---

### Task 6: Verificação final

**Files:** nenhum novo — só validação.

**Step 1: Build completo**

Run: `npm run build`
Expected: `✓ Compiled successfully`, sem erros de TypeScript, e a rota
`/admin/integracoes` (+ `/admin/integracoes/callback`) aparecendo na tabela de rotas
impressa no final do build.

**Step 2: Typecheck e lint isolados (dupla checagem)**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 erros; só os 8 warnings pré-existentes de `<img>`/`alt` em
`lib/renderer/templates/templateA.tsx`/`templateB.tsx` (documentados, não related a essa
mudança).

**Step 3: Grep de segurança — nenhum resquício de Service Account**

Run: `grep -rn "GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY" --include="*.ts" --include="*.tsx" --include="*.md" .`
Expected: nenhum resultado fora de `PLAN.md`/specs antigas (registro histórico é
esperado e não deve ser removido) — nenhuma referência viva em código (`lib/`, `app/`)
ou em `.env.example`/`docs/DEPLOY.md`/`docs/CLAUDE.md`.

**Step 4: Teste manual (documentar no PLAN.md, não automatizável nesta sessão)**

Não executar agora (depende do Victor ter as credenciais reais coladas no
`.env.local`) — só documentar como próximo passo manual: completar o fluxo em
`/admin/integracoes`, colar o refresh token, reiniciar `npm run dev`, e chamar
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/drive-ingest`
com um arquivo de teste solto na pasta do Drive.

**Step 5: Atualizar `PLAN.md` (seção M11)**

Adicionar uma entrada `[x]` resumindo a implementação (arquivos criados/modificados,
decisões da spec, e o teste manual pendente do passo 4 acima), mesmo padrão das demais
entradas de M11 já registradas nesta sessão.

**Step 6: Commit final**

```bash
git add PLAN.md
git commit -m "docs(plan): registra implementacao do OAuth do Google Drive no PLAN.md"
git push origin main
```
