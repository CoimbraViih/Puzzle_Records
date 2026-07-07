import { createServiceClient } from "@/lib/supabase/service";

/**
 * Busca e-mails de todos os usuários aprovador/admin. Usa o cliente
 * service-role pelo mesmo motivo de notifyApprovers.ts: a policy
 * profiles_select_own_or_admin bloqueia esta leitura em nome do usuário
 * logado — é uma notificação de sistema.
 */
export async function getApproverAndAdminEmails(): Promise<
  { emails: string[] } | { error: string }
> {
  const supabase = createServiceClient();
  const { data: recipients, error } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["aprovador", "admin"]);

  if (error) {
    return { error: `Falha ao buscar destinatários da notificação: ${error.message}` };
  }
  if (!recipients || recipients.length === 0) {
    return { error: "Nenhum aprovador/admin cadastrado para notificar." };
  }

  return { emails: recipients.map((r) => r.email) };
}
