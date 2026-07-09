import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  buildMonthGrid,
  groupPostsByDay,
  monthLabel,
} from "@/lib/calendar/month";
import type { PostWithRelations } from "@/lib/types/post";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function monthHref(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `/calendario?mes=${d.getUTCFullYear()}-${mm}`;
}

function timeInSaoPaulo(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoTimestamp));
}

export function MonthCalendar({
  year,
  month,
  posts,
}: {
  year: number;
  month: number;
  posts: PostWithRelations[];
}) {
  const weeks = buildMonthGrid(year, month);
  const byDay = groupPostsByDay(posts);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold capitalize text-foreground">
          {monthLabel(year, month)}
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={monthHref(year, month, -1)}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={monthHref(year, month, +1)}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((label) => (
              <div
                key={label}
                className="px-2 py-1 text-xs font-medium text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>
          {weeks.map((week, i) => (
            <div key={i} className="grid grid-cols-7 gap-px">
              {week.map((day) => {
                const dayPosts = byDay.get(day.iso) ?? [];
                return (
                  <div
                    key={day.iso}
                    className={`min-h-24 rounded-sm border border-border/50 p-1.5 ${
                      day.inMonth ? "bg-muted/20" : "bg-transparent opacity-40"
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">
                      {day.day}
                    </span>
                    <div className="mt-1 flex flex-col gap-1">
                      {dayPosts.map((post) => (
                        <div
                          key={post.id}
                          className={`truncate rounded px-1 py-0.5 text-[11px] leading-tight ${
                            post.status === "publicado"
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-foreground"
                          }`}
                          title={`${timeInSaoPaulo(
                            post.scheduled_at ?? post.published_at ?? ""
                          )} — ${post.headline ?? post.caption ?? "Post"}`}
                        >
                          {timeInSaoPaulo(
                            post.scheduled_at ?? post.published_at ?? ""
                          )}{" "}
                          {post.headline ?? post.caption ?? "Post"}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/40" /> Agendado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" /> Publicado
        </span>
      </div>
    </div>
  );
}
