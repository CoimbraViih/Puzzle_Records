import { NextResponse } from "next/server";

import { createDriveClient } from "@/lib/drive/client";
import { findOrCreateProcessedFolder } from "@/lib/drive/folders";
import { ingestFilePair } from "@/lib/drive/ingestFile";
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
    console.error(
      "Falha ao listar arquivos do Drive (tenta de novo no próximo cron):",
      err
    );
    return NextResponse.json({ processed: 0 });
  }

  const pairs = pairFiles(files);
  if (pairs.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const processedFolderId = await findOrCreateProcessedFolder(drive, rootFolderId);
  const supabase = createServiceClient();

  for (const pair of pairs) {
    await ingestFilePair(drive, supabase, pair, processedFolderId, rootFolderId);
  }

  return NextResponse.json({ processed: pairs.length });
}
