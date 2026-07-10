import type { SupabaseClient } from "@supabase/supabase-js";

export interface SocialAccountResolution {
  socialAccountId: string | null;
  warning: string | null;
}

/**
 * Conta única (decisão de 10/07/2026, PLAN.md) — não há mais matching por
 * handle no metadado do Drive, só a única linha de social_accounts
 * cadastrada em /admin/contas. Sem conta cadastrada (ou mais de uma,
 * configuração inválida), o post é criado do mesmo jeito com aviso
 * visível — nunca falha em silêncio.
 */
export async function resolveSocialAccount(
  supabase: SupabaseClient
): Promise<SocialAccountResolution> {
  const { data, error } = await supabase.from("social_accounts").select("id");

  if (error || !data || data.length === 0) {
    return {
      socialAccountId: null,
      warning: "Nenhuma conta social cadastrada em /admin/contas.",
    };
  }

  if (data.length > 1) {
    return {
      socialAccountId: data[0].id,
      warning: `${data.length} contas sociais cadastradas — usando a primeira (esperado: só 1, conta única).`,
    };
  }

  return { socialAccountId: data[0].id, warning: null };
}
