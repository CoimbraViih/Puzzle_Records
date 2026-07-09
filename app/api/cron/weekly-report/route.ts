import { NextResponse } from "next/server";

import { getResendClient, EMAIL_FROM } from "@/lib/email/client";
import { getApproverAndAdminEmails } from "@/lib/email/recipients";
import { weeklyReportSubject, weeklyReportBody } from "@/lib/email/templates";
import { buildWeeklySummary } from "@/lib/reports/weeklySummary";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed, mesmo padrão dos demais crons
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await buildWeeklySummary();
  if ("error" in summary) {
    console.error("[weekly-report]", summary.error);
    return NextResponse.json({ error: summary.error }, { status: 500 });
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[weekly-report] RESEND_API_KEY não configurada.");
    return NextResponse.json({ error: "resend_not_configured" }, { status: 500 });
  }

  const recipients = await getApproverAndAdminEmails();
  if ("error" in recipients) {
    console.error("[weekly-report]", recipients.error);
    return NextResponse.json({ error: recipients.error }, { status: 500 });
  }

  const { error: sendError } = await resend.emails.send({
    from: EMAIL_FROM,
    to: EMAIL_FROM,
    bcc: recipients.emails,
    subject: weeklyReportSubject(summary.weekEndIso),
    html: weeklyReportBody(summary),
  });

  if (sendError) {
    console.error("[weekly-report] falha no envio:", sendError.message);
    return NextResponse.json({ error: sendError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, published: summary.publishedCount });
}
