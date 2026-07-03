"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/types/social-account";

export type SocialAccountFormState = { error?: string } | undefined;

export async function createSocialAccount(
  _prevState: SocialAccountFormState,
  formData: FormData
): Promise<SocialAccountFormState> {
  const network = String(formData.get("network") ?? "") as SocialNetwork;
  const handle = String(formData.get("handle") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!SOCIAL_NETWORKS.includes(network) || !handle || !displayName) {
    return { error: "Preencha rede, @handle e nome de exibição." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .insert({ network, handle, display_name: displayName });

  if (error) {
    return { error: "Não foi possível salvar a conta social." };
  }

  revalidatePath("/admin/contas");
  return undefined;
}

export async function deleteSocialAccount(
  accountId: string,
  _formData: FormData
) {
  const supabase = await createClient();
  const { error } = await supabase.from("social_accounts").delete().eq("id", accountId);
  if (error) {
    console.error("Falha ao excluir conta social:", error);
  }
  revalidatePath("/admin/contas");
}
