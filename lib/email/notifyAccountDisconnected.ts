import { getResendClient, EMAIL_FROM } from "./client";
import { getApproverAndAdminEmails } from "./recipients";
import { accountDisconnectedSubject, accountDisconnectedBody } from "./templates";

/**
 * Notifica aprovadores/admin quando uma conta social atinge o limiar de
 * falhas consecutivas de publicação. Nunca lança — qualquer falha (env var
 * ausente, erro de banco, erro do Resend) vira uma string de erro, sem
 * derrubar o cron de publicação que chamou esta função.
 */
export async function notifyAccountDisconnected(
  accountLabel: string
): Promise<string | null> {
  try {
    const resend = getResendClient();
    if (!resend) {
      return "RESEND_API_KEY não configurada — alerta de desconexão não enviado.";
    }

    const recipients = await getApproverAndAdminEmails();
    if ("error" in recipients) {
      return recipients.error;
    }

    const { error: sendError } = await resend.emails.send({
      from: EMAIL_FROM,
      to: EMAIL_FROM,
      bcc: recipients.emails,
      subject: accountDisconnectedSubject(accountLabel),
      html: accountDisconnectedBody(accountLabel),
    });

    if (sendError) {
      return `Falha ao enviar e-mail via Resend: ${sendError.message}`;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Falha inesperada ao notificar desconexão: ${message}`;
  }
}
