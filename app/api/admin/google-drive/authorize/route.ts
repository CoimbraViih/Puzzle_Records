import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createOAuth2Client, DRIVE_OAUTH_SCOPES } from "@/lib/drive/client";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

/**
 * Inicia o fluxo de autorização OAuth do Google Drive — só admin. Redireciona
 * pra tela de consentimento do Google; o retorno cai em
 * /admin/integracoes/callback (GOOGLE_OAUTH_REDIRECT_URI).
 * access_type=offline + prompt=consent garantem que o Google sempre devolva
 * um refresh_token, mesmo numa reconexão.
 * Um `state` aleatório é gerado e guardado num cookie httpOnly de curta
 * duração — o callback confere os dois batem antes de trocar o código,
 * protegendo contra CSRF / injeção de código de autorização.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  let authUrl: string;
  const state = crypto.randomUUID();
  try {
    const oauth2Client = createOAuth2Client();
    authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: DRIVE_OAUTH_SCOPES,
      state,
    });
  } catch (err) {
    console.error("Falha ao montar a URL de autorização do Google Drive:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
