import { createClient } from "@/lib/supabase/server";

export interface NotificationRow {
  id: string;
  type: "conta_desconectada";
  message: string;
  created_at: string;
  read_at: string | null;
}

/** Últimas 20 notificações, mais recentes primeiro (mesmo escopo "equipe pequena, todo mundo vê tudo" do M13). */
export async function listNotifications(): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, message, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[notifications] falha ao listar notificações:", error.message);
    return [];
  }
  return data ?? [];
}

export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) {
    console.error("[notifications] falha ao contar não-lidas:", error.message);
    return 0;
  }
  return count ?? 0;
}
