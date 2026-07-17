"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/types/social-account";

export type SocialAccountFormState = { error?: string } | undefined;

/**
 * Cria uma social_account a partir de uma conta já conectada no Zernio
 * (GET /accounts) — um clique, sem o usuário caçar/copiar nenhum ID. Ver
 * `lib/publishing/zernio.ts#listZernioAccounts` e a decisão de simplificação
 * em PLAN.md. Idempotente: se esse zernio_account_id já estiver associado a
 * alguma conta, não duplica.
 */
export async function addSocialAccountFromZernio(formData: FormData): Promise<void> {
  const network = String(formData.get("network") ?? "") as SocialNetwork;
  const handle = String(formData.get("handle") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const zernioAccountId = String(formData.get("zernio_account_id") ?? "").trim();

  if (!SOCIAL_NETWORKS.includes(network) || !handle || !zernioAccountId) {
    console.error("[admin/contas] dados incompletos vindos do Zernio, ignorando:", {
      network,
      handle,
      zernioAccountId,
    });
    return;
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("social_accounts")
    .select("id")
    .eq("zernio_account_id", zernioAccountId)
    .maybeSingle();
  if (existing) {
    revalidatePath("/admin");
    return;
  }

  const { error } = await supabase.from("social_accounts").insert({
    network,
    handle,
    display_name: displayName || handle,
    zernio_account_id: zernioAccountId,
  });

  if (error) {
    console.error("[admin/contas] falha ao criar conta a partir do Zernio:", error);
  }
  revalidatePath("/admin");
}

export async function createSocialAccount(
  _prevState: SocialAccountFormState,
  formData: FormData
): Promise<SocialAccountFormState> {
  const network = String(formData.get("network") ?? "") as SocialNetwork;
  const handle = String(formData.get("handle") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const zernioAccountId =
    (formData.get("zernio_account_id") as string)?.trim() || null;

  if (!SOCIAL_NETWORKS.includes(network) || !handle || !displayName) {
    return { error: "Preencha rede, @handle e nome de exibição." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("social_accounts").insert({
    network,
    handle,
    display_name: displayName,
    zernio_account_id: zernioAccountId,
  });

  if (error) {
    return { error: "Não foi possível salvar a conta social." };
  }

  revalidatePath("/admin");
  return undefined;
}

export async function updateZernioAccountId(
  accountId: string,
  formData: FormData
) {
  const zernioAccountId =
    (formData.get("zernio_account_id") as string)?.trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .update({ zernio_account_id: zernioAccountId })
    .eq("id", accountId);

  if (error) {
    console.error("Falha ao atualizar zernio_account_id:", accountId, error);
  }
  revalidatePath("/admin");
}

export async function updateAcervoSlots(
  accountId: string,
  formData: FormData
) {
  const raw = String(formData.get("acervo_daily_slots") ?? "");
  const slots = raw
    .split(",")
    .map((slot) => slot.trim())
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot));

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .update({ acervo_daily_slots: slots })
    .eq("id", accountId);

  if (error) {
    console.error("Falha ao atualizar acervo_daily_slots:", accountId, error);
  }
  revalidatePath("/admin");
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
  revalidatePath("/admin");
}
