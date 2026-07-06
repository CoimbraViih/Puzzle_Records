import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyApprovers } from "@/lib/email/notifyApprovers";

const SLA_HOURS = 4;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000).toISOString();

  // `submitted_for_approval_at` deveria sempre existir para um post em
  // pendente_aprovacao (submitForApproval sempre grava), mas trata o caso
  // de uma linha sem esse carimbo (ex: dado legado) como vencida também —
  // um `.lt()` puro nunca é verdadeiro contra null, o que deixaria esse
  // post preso sem alerta para sempre (justamente o cenário que este cron
  // existe para evitar).
  const { data: overdue, error } = await supabase
    .from("posts")
    .select("id, headline")
    .eq("status", "pendente_aprovacao")
    .or(`submitted_for_approval_at.is.null,submitted_for_approval_at.lt.${cutoff}`)
    .is("sla_alert_sent_at", null);

  if (error) {
    console.error("[sla-alert] falha ao buscar posts vencidos:", error.message);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let alerted = 0;
  for (const post of overdue ?? []) {
    const notificationError = await notifyApprovers({
      kind: "sla_vencido",
      postId: post.id,
      headline: post.headline,
    });

    const { error: updateError } = await supabase
      .from("posts")
      .update({
        sla_alert_sent_at: notificationError ? null : new Date().toISOString(),
        notification_error: notificationError,
      })
      .eq("id", post.id);

    if (updateError) {
      console.error(`[sla-alert] falha ao gravar alerta do post ${post.id}:`, updateError.message);
      continue;
    }
    if (!notificationError) alerted += 1;
  }

  return NextResponse.json({ alerted, total: (overdue ?? []).length });
}
