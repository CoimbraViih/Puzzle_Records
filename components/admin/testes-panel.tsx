"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { QaTestRun } from "@/lib/qa/queries";
import { cn } from "@/lib/utils";

const RESULT_STYLES: Record<QaTestRun["result"], string> = {
  ok: "border-l-primary text-foreground",
  fail: "border-l-destructive text-foreground",
  info: "border-l-border text-muted-foreground",
};

export function TestesPanel({ initialRuns }: { initialRuns: QaTestRun[] }) {
  const [runs, setRuns] = useState(initialRuns);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("qa_test_runs-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "qa_test_runs" },
        (payload) => {
          setRuns((current) => [payload.new as QaTestRun, ...current].slice(0, 200));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma execução de teste registrada ainda.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {runs.map((run) => (
        <div
          key={run.id}
          className={cn(
            "rounded-md border-l-4 bg-card px-3 py-2 text-sm",
            RESULT_STYLES[run.result]
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{run.step}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(run.created_at).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{run.target}</p>
          {run.detail && <p className="mt-1 text-xs">{run.detail}</p>}
        </div>
      ))}
    </div>
  );
}
