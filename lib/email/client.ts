import { Resend } from "resend";

let cached: Resend | null = null;

/**
 * Retorna um cliente Resend, ou `null` se `RESEND_API_KEY` não estiver
 * configurada. Nunca lança — segue o mesmo espírito de "nunca falhar em
 * silêncio, mas nunca derrubar o fluxo principal por causa de uma
 * integração secundária" usado em outros pontos do projeto (ver
 * `art_generation_error`/`copy_generation_error` em `lib/posts`). Quem
 * chama decide o que fazer com o `null` (aqui, gravar em
 * `notification_error`).
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cached) cached = new Resend(apiKey);
  return cached;
}

export const EMAIL_FROM =
  process.env.RESEND_FROM_EMAIL ?? "Puzzle Records <onboarding@resend.dev>";
