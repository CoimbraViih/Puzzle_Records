import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * Autentica no Google Drive via Service Account. A pasta de ingestão
 * precisa estar compartilhada (papel "Editor") com o e-mail "client_email"
 * dessa chave — ver docs/DEPLOY.md.
 */
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
