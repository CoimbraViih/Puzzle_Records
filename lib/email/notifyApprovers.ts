import { createServiceClient } from "@/lib/supabase/service";
import { getResendClient, EMAIL_FROM } from "./client";
import {
  newPostSubject,
  newPostBody,
  slaAlertSubject,
  slaAlertBody,
} from "./templates";

type NotifyParams = {
  kind: "novo_post" | "sla_vencido";
  postId: string;
  headline: string | null;
};

/**
 * Notifica todos os usuários `aprovador`/`admin` por e-mail. Usa o cliente
 * de service-role (`createServiceClient`) porque a policy
 * `profiles_select_own_or_admin` (`supabase/migrations/0001_profiles.sql:28-30`)
 * bloqueia um usuário `equipe_conteudo` de listar e-mails de outros
 * perfis — esta é uma notificação de sistema, não uma leitura em nome do
 * usuário logado.
 *
 * Nunca lança: qualquer falha (env var ausente, erro de banco, lista de
 * destinatários vazia, erro do Resend) vira uma string de erro retornada
 * para quem chamou gravar em `notification_error`, sem derrubar o fluxo
 * principal (envio do post para aprovação).
 */
export async function notifyApprovers({
  kind,
  postId,
  headline,
}: NotifyParams): Promise<string | null> {
  try {
    const resend = getResendClient();
    if (!resend) {
      return "RESEND_API_KEY não configurada — notificação não enviada.";
    }

    const supabase = createServiceClient();
    const { data: recipients, error } = await supabase
      .from("profiles")
      .select("email")
      .in("role", ["aprovador", "admin"]);

    if (error) {
      return `Falha ao buscar destinatários da notificação: ${error.message}`;
    }
    if (!recipients || recipients.length === 0) {
      return "Nenhum aprovador/admin cadastrado para notificar.";
    }

    const subject =
      kind === "novo_post"
        ? newPostSubject(headline)
        : slaAlertSubject(headline);
    const html =
      kind === "novo_post"
        ? newPostBody(postId, headline)
        : slaAlertBody(postId, headline);

    const { error: sendError } = await resend.emails.send({
      from: EMAIL_FROM,
      to: recipients.map((r) => r.email),
      subject,
      html,
    });

    if (sendError) {
      return `Falha ao enviar e-mail via Resend: ${sendError.message}`;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Falha inesperada ao notificar aprovadores: ${message}`;
  }
}
