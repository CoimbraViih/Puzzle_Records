import { NextResponse } from "next/server";

import { isSlotTaken, pickCandidateForSlot } from "@/lib/acervo/scheduler";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

const TIMEZONE = "America/Sao_Paulo";

function slotDateTime(dayOffset: number, slot: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const [hour, minute] = slot.split(":");

  // Constrói a data no fuso de São Paulo (UTC-3, sem horário de verão desde
  // 2019) somando o offset manualmente — sem lib de fuso horário no projeto.
  const base = new Date(
    `${year}-${month}-${String(Number(day) + dayOffset).padStart(2, "0")}T${hour}:${minute}:00-03:00`
  );
  return base;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  let scheduled = 0;

  const { data: accounts, error: accountsError } = await supabase
    .from("social_accounts")
    .select("id, acervo_daily_slots")
    .eq("network", "instagram")
    .not("acervo_daily_slots", "eq", "{}");

  if (accountsError) {
    console.error("[acervo-schedule] falha ao buscar contas:", accountsError.message);
    return NextResponse.json({ error: "falha ao buscar contas" }, { status: 500 });
  }

  for (const account of accounts ?? []) {
    const slots = (account.acervo_daily_slots as string[]) ?? [];
    if (slots.length === 0) continue;

    const { data: occupied } = await supabase
      .from("posts")
      .select("scheduled_at, published_at")
      .eq("social_account_id", account.id)
      .in("status", ["aprovado", "publicado"]);

    const occupiedDateTimes = (occupied ?? [])
      .map((post) => post.scheduled_at ?? post.published_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value));

    const { data: recentPosts } = await supabase
      .from("posts")
      .select("artist_id, scheduled_at, published_at")
      .in("status", ["aprovado", "publicado"])
      .not("artist_id", "is", null);

    const recentArtistPosts = (recentPosts ?? [])
      .map((post) => ({
        artist_id: post.artist_id as string | null,
        scheduled_or_published_at: post.scheduled_at ?? post.published_at,
      }))
      .filter(
        (entry): entry is { artist_id: string; scheduled_or_published_at: string } =>
          Boolean(entry.scheduled_or_published_at)
      );

    for (const dayOffset of [0, 1]) {
      for (const slot of slots) {
        const target = slotDateTime(dayOffset, slot);
        if (target.getTime() <= now.getTime()) continue;

        if (isSlotTaken(target, occupiedDateTimes)) continue;

        const { data: candidates } = await supabase
          .from("posts")
          .select("id, artist_id, created_at")
          .eq("social_account_id", account.id)
          .eq("content_source", "acervo")
          .eq("status", "aprovado")
          .is("scheduled_at", null);

        const chosen = pickCandidateForSlot(
          target,
          candidates ?? [],
          recentArtistPosts
        );

        if (!chosen) continue;

        const { data: claimed, error: claimError } = await supabase
          .from("posts")
          .update({ scheduled_at: target.toISOString() })
          .eq("id", chosen.id)
          .is("scheduled_at", null)
          .select("id");

        if (claimError || !claimed || claimed.length === 0) {
          // Outra execução do cron já preencheu esse post entre a busca e
          // aqui — não duplica.
          continue;
        }

        occupiedDateTimes.push(target);
        scheduled += 1;
      }
    }
  }

  return NextResponse.json({ scheduled });
}
