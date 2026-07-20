import { NextResponse } from "next/server";

import { isSlotTaken, pickCandidateForSlot } from "@/lib/scheduling/dailySlots";
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
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const [hour, minute] = slot.split(":");

  // Normaliza o rollover de mês/ano usando Date.UTC + setUTCDate, que lida
  // corretamente com "31 + 1 dia" virando o dia 1 do mês seguinte (e
  // dezembro virando janeiro do ano seguinte). Só a data de calendário
  // importa aqui — o instante final é reconstruído abaixo a partir do
  // ano/mês/dia normalizados + hora/minuto do slot + offset fixo -03:00.
  const normalized = new Date(Date.UTC(year, month - 1, day));
  normalized.setUTCDate(normalized.getUTCDate() + dayOffset);

  const normalizedYear = normalized.getUTCFullYear();
  const normalizedMonth = String(normalized.getUTCMonth() + 1).padStart(2, "0");
  const normalizedDay = String(normalized.getUTCDate()).padStart(2, "0");

  // Constrói a data no fuso de São Paulo (UTC-3, sem horário de verão desde
  // 2019) somando o offset manualmente — sem lib de fuso horário no projeto.
  const base = new Date(
    `${normalizedYear}-${normalizedMonth}-${normalizedDay}T${hour}:${minute}:00-03:00`
  );
  return base;
}

/**
 * Renomeado de acervo-schedule (M8) pro M21: deixou de ser exclusivo de
 * acervo, agora distribui QUALQUER post aprovado sem scheduled_at pelos
 * horários do dia (daily_post_slots) — conteúdo curado (Drive/Post
 * rápido) tem prioridade sobre acervo dentro do mesmo slot (ver
 * lib/scheduling/dailySlots.ts). Ver
 * docs/superpowers/specs/2026-07-20-horarios-estrategicos-design.md.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  let scheduled = 0;

  const { data: accounts, error: accountsError } = await supabase
    .from("social_accounts")
    .select("id, daily_post_slots")
    .eq("network", "instagram")
    .not("daily_post_slots", "eq", "{}");

  if (accountsError) {
    console.error("[daily-schedule] falha ao buscar contas:", accountsError.message);
    return NextResponse.json({ error: "falha ao buscar contas" }, { status: 500 });
  }

  for (const account of accounts ?? []) {
    const slots = (account.daily_post_slots as string[]) ?? [];
    if (slots.length === 0) continue;

    const { data: occupied, error: occupiedError } = await supabase
      .from("posts")
      .select("scheduled_at, published_at")
      .eq("social_account_id", account.id)
      .in("status", ["aprovado", "publicado"]);

    if (occupiedError) {
      console.error(
        "[daily-schedule] falha ao buscar horários ocupados da conta:",
        occupiedError.message
      );
    }

    const occupiedDateTimes = (occupied ?? [])
      .map((post) => post.scheduled_at ?? post.published_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value));

    for (const dayOffset of [0, 1]) {
      for (const slot of slots) {
        const target = slotDateTime(dayOffset, slot);
        if (Number.isNaN(target.getTime())) continue;
        if (target.getTime() <= now.getTime()) continue;

        if (isSlotTaken(target, occupiedDateTimes)) continue;

        const { data: candidates, error: candidatesError } = await supabase
          .from("posts")
          .select("id, created_at, content_source")
          .eq("social_account_id", account.id)
          .eq("status", "aprovado")
          .is("scheduled_at", null);

        if (candidatesError) {
          console.error(
            "[daily-schedule] falha ao buscar candidatos aprovados:",
            candidatesError.message
          );
        }

        const chosen = pickCandidateForSlot(candidates ?? []);

        if (!chosen) continue;

        const { data: claimed, error: claimError } = await supabase
          .from("posts")
          .update({ scheduled_at: target.toISOString() })
          .eq("id", chosen.id)
          .eq("status", "aprovado")
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
