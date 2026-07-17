import { google, drive_v3 } from "googleapis";

export const DRIVE_OAUTH_SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * Monta o cliente OAuth2 do Google (client id/secret/redirect da env), usado
 * tanto pra gerar a URL de consentimento
 * (app/api/admin/google-drive/authorize/route.ts) quanto, aqui, pra
 * autenticar as chamadas de Drive com o refresh token já obtido.
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
 * refresh token é obtido uma única vez pelo admin em /admin (aba Integrações) e
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
