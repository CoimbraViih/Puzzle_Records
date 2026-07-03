import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { ROLES, type Role } from "@/lib/types/profile";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const email = String(body.email ?? "");
  const role = String(body.role ?? "") as Role;

  if (!email || !ROLES.includes(role)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  let serviceClient: ReturnType<typeof createServiceClient>;
  try {
    serviceClient = createServiceClient();
  } catch (err) {
    console.error("Falha ao criar o cliente Supabase com service role:", err);
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { role },
    redirectTo: `${siteUrl}/auth/confirm?next=/auth/definir-senha`,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
