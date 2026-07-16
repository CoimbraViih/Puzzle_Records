import { NextResponse } from "next/server";

import { advanceDriveItemEdit, type CutProDriveItem } from "@/lib/cutpro/pipeline";
import { checkCutProBalance } from "@/lib/cutpro/balanceMonitor";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

const TRANSITIONAL_STATUSES: CutProDriveItem["edit_status"][] = ["enviando", "clipando", "renderizando"];

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // D6: monitor de saldo no início do ciclo — não bloqueia o avanço dos
  // itens em edição mesmo se a checagem de saldo falhar.
  await checkCutProBalance(supabase);

  const { data: items, error } = await supabase
    .from("drive_items")
    .select(
      "id, filename, media_storage_path, edit_status, cutpro_template_id, cutpro_video_id, cutpro_submission_id, cutpro_clip_id, cutpro_render_id"
    )
    .in("edit_status", TRANSITIONAL_STATUSES)
    .order("updated_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[cutpro-pipeline] falha ao listar itens em edição:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  for (const item of (items as CutProDriveItem[]) ?? []) {
    await advanceDriveItemEdit(supabase, item);
  }

  return NextResponse.json({ processed: items?.length ?? 0 });
}
