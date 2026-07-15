/**
 * Conversão entre o valor cru de um `<input type="datetime-local">`
 * ("YYYY-MM-DDTHH:mm", sem fuso) — que a UI sempre rotula como "horário de
 * São Paulo" (ver página /calendario) — e o timestamp UTC gravado no banco.
 * Brasil aboliu o horário de verão em 2019, então America/Sao_Paulo hoje é
 * um offset fixo -03:00 o ano inteiro.
 */
const SAO_PAULO_OFFSET = "-03:00";

/** "2026-07-14T22:32" (hora de SP) → "2026-07-15T01:32:00.000Z" (UTC). */
export function spDateTimeLocalToUtcIso(value: string): string {
  return new Date(`${value}:00${SAO_PAULO_OFFSET}`).toISOString();
}

/** ISO UTC do banco → "2026-07-14T22:32" (hora de SP) para o input. */
export function utcIsoToSpDateTimeLocal(isoTimestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoTimestamp));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
