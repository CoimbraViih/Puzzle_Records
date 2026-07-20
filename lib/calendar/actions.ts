"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

/**
 * Horários-alvo (HH:MM) do dia pra distribuição automática de posts
 * aprovados (cron `daily-schedule`) — movida de `components/admin/
 * contas-actions.ts` (`updateAcervoSlots`) quando o agendador deixou de
 * ser exclusivo do acervo (M21). Editável direto em `/calendario`, onde o
 * usuário já visualiza os posts agendados.
 */
export async function updateDailyPostSlots(
  accountId: string,
  formData: FormData
) {
  const raw = String(formData.get("daily_post_slots") ?? "");
  const slots = raw
    .split(",")
    .map((slot) => slot.trim())
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot));

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .update({ daily_post_slots: slots })
    .eq("id", accountId);

  if (error) {
    console.error("Falha ao atualizar daily_post_slots:", accountId, error);
  }
  revalidatePath("/calendario");
}
