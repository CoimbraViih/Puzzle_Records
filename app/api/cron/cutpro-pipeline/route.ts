import { NextResponse } from "next/server";

import { advanceCutProEdit, type CutProEditableRow, type CutProTable } from "@/lib/cutpro/pipeline";
import { checkCutProBalance } from "@/lib/cutpro/balanceMonitor";
import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

const TRANSITIONAL_STATUSES: CutProEditableRow["edit_status"][] = ["enviando", "clipando", "renderizando"];

/**
 * drive_items e posts têm as mesmas colunas de estado do Cut.Pro (migration
 * 0028), mas nomes diferentes pra mídia/nome original — drive_items guarda
 * o nome de arquivo do Drive (`filename`) separado do path gerado no
 * Storage (`media_storage_path`); posts não tem "nome de arquivo" próprio,
 * só o path do Storage (`media_url`), que já sai com a extensão certa —
 * então serve pros dois papéis via alias.
 */
async function fetchEligibleItems(
  supabase: SupabaseClient,
  table: CutProTable
): Promise<CutProEditableRow[]> {
  const selectColumns =
    table === "drive_items"
      ? "id, filename, media_storage_path, edit_status, cutpro_template_id, cutpro_video_id, cutpro_submission_id, cutpro_clip_id, cutpro_render_id"
      : "id, filename:media_url, media_storage_path:media_url, edit_status, cutpro_template_id, cutpro_video_id, cutpro_submission_id, cutpro_clip_id, cutpro_render_id";

  const { data, error } = await supabase
    .from(table)
    .select(selectColumns)
    .in("edit_status", TRANSITIONAL_STATUSES)
    .order("updated_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error(`[cutpro-pipeline] falha ao listar itens em edição (${table}):`, error);
    return [];
  }

  return (data as unknown as CutProEditableRow[]) ?? [];
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // D6: monitor de saldo no início do ciclo — não bloqueia o avanço dos
  // itens em edição mesmo se a checagem de saldo falhar.
  await checkCutProBalance(supabase);

  const [driveItems, postItems] = await Promise.all([
    fetchEligibleItems(supabase, "drive_items"),
    fetchEligibleItems(supabase, "posts"),
  ]);

  for (const item of driveItems) {
    await advanceCutProEdit(supabase, "drive_items", item);
  }
  for (const item of postItems) {
    await advanceCutProEdit(supabase, "posts", item);
  }

  return NextResponse.json({ processed: driveItems.length + postItems.length });
}
