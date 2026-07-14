import { cookies } from "next/headers";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createOAuth2Client } from "@/lib/drive/client";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/app/api/admin/google-drive/authorize/route";
import { PageHeader } from "@/components/dashboard/page-header";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

export default async function GoogleDriveCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; state?: string }>;
}) {
  const admin = await requireAdmin();
  const { code, error: googleError, state } = await searchParams;

  const cookieStore = await cookies();
  // Server Components não conseguem apagar cookies — só leitura/comparação;
  // o cookie expira sozinho em 10 min (maxAge definido no route de authorize).
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  const stateIsValid = Boolean(state) && Boolean(expectedState) && state === expectedState;

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

      {admin && !googleError && code && !stateIsValid && (
        <p className="text-sm text-destructive">
          Falha de segurança: state inválido ou ausente. Tente conectar novamente.
        </p>
      )}

      {admin && !googleError && !code && (
        <p className="text-sm text-destructive">
          Código de autorização ausente na URL de retorno do Google.
        </p>
      )}

      {admin && !googleError && code && stateIsValid && <ExchangeResult code={code} />}
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
