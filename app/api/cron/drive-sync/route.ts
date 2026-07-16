import { NextResponse } from "next/server";

import { createDriveClient } from "@/lib/drive/client";
import { mirrorFilePair, markRemovedDriveItems } from "@/lib/drive/mirrorFile";
import { listRootFiles } from "@/lib/drive/listPendingFiles";
import { pairFiles } from "@/lib/drive/pairFiles";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) {
    console.error("GOOGLE_DRIVE_FOLDER_ID não configurado.");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let drive;
  try {
    drive = createDriveClient();
  } catch (err) {
    console.error("Falha ao autenticar com o Google Drive:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let files;
  try {
    files = await listRootFiles(drive, rootFolderId);
  } catch (err) {
    console.error("Falha ao listar arquivos do Drive (tenta de novo no próximo cron):", err);
    return NextResponse.json({ mirrored: 0 });
  }

  const pairs = pairFiles(files);
  const supabase = createServiceClient();

  for (const pair of pairs) {
    await mirrorFilePair(drive, supabase, pair);
  }

  await markRemovedDriveItems(
    supabase,
    pairs.map((pair) => pair.media.id)
  );

  return NextResponse.json({ mirrored: pairs.length });
}
