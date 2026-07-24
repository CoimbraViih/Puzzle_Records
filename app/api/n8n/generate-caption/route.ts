import { NextResponse } from "next/server";

import {
  CopyGenerationError,
  generateCopyVariations,
} from "@/lib/openai/generateCopy";
import { POST_TYPES, type PostType } from "@/lib/types/post";

// Chamada pelo workflow n8n "Puzzle Records — Drive → Instagram" depois que
// a Cut.Pro já clipou o vídeo — só cobre o modo "text" do motor de copy
// existente (o título/resumo do clipe já é o contexto, não reanalisa vídeo
// aqui). Ver docs/superpowers/specs/2026-07-24-n8n-legenda-app-mover-processados-design.md.
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { postType?: unknown; fact?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const postType = String(body.postType ?? "viral_geral") as PostType;
  const fact = String(body.fact ?? "").trim();

  if (!POST_TYPES.includes(postType)) {
    return NextResponse.json({ error: "invalid_post_type" }, { status: 400 });
  }
  if (!fact) {
    return NextResponse.json({ error: "missing_fact" }, { status: 400 });
  }

  try {
    const variations = await generateCopyVariations({
      mode: "text",
      postType,
      fact,
      trackName: null,
    });

    return NextResponse.json({
      headline: variations[0].headline,
      caption: variations[0].caption,
      variations,
    });
  } catch (err) {
    const message =
      err instanceof CopyGenerationError
        ? err.message
        : "Falha ao gerar manchete/legenda via OpenAI.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
