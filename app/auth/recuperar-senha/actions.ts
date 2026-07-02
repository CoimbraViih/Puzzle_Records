"use server";

import { createClient } from "@/lib/supabase/server";

export type RecoverState = { message?: string; error?: string } | undefined;

export async function requestPasswordReset(
  _prevState: RecoverState,
  formData: FormData
): Promise<RecoverState> {
  const email = String(formData.get("email") ?? "");

  if (!email) {
    return { error: "Informe um e-mail." };
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=/auth/redefinir-senha`,
  });

  // Mensagem genérica de propósito — não revela se o e-mail existe.
  return {
    message: "Se o e-mail existir, você receberá um link de recuperação.",
  };
}
