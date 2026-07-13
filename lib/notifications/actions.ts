"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createClient } from "@/lib/supabase/server";

/**
 * Marca todas as notificações não-lidas como lidas. A UI (notification-bell,
 * client component) atualiza o estado local otimisticamente após chamar
 * essa action -- sem revalidatePath, porque o sino vive no layout
 * compartilhado de todo o grupo (dashboard), não numa página só.
 */
export async function markAllNotificationsRead() {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  if (error) {
    console.error("[notifications] falha ao marcar como lidas:", error.message);
  }
}
