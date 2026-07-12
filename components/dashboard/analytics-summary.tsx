import type { ReactNode } from "react";

import type { AnalyticsSummary } from "@/lib/analytics/queries";

function SummaryTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: AnalyticsSummary["byAccount"];
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">Nome</th>
              <th className="py-1">Posts</th>
              <th className="py-1">Curtidas</th>
              <th className="py-1">Comentários</th>
              <th className="py-1">Alcance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border/50 text-foreground">
                <td className="py-1">{row.label}</td>
                <td className="py-1">{row.posts}</td>
                <td className="py-1">{row.likes}</td>
                <td className="py-1">{row.comments}</td>
                <td className="py-1">{row.reach}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AnalyticsSummarySection({
  summary,
  metricsErrorCount,
  headerAction,
}: {
  summary: AnalyticsSummary;
  metricsErrorCount: number;
  headerAction?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Analytics (últimos 30 dias)
        </h2>
        {headerAction}
      </div>
      {metricsErrorCount > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          ⚠️ {metricsErrorCount} post(s) com falha na coleta de métricas — os
          números abaixo podem estar incompletos. Ver logs do cron collect-metrics.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SummaryTable
          title="Por conta"
          rows={summary.byAccount}
          emptyLabel="Sem métricas coletadas ainda."
        />
        <SummaryTable
          title="Por horário"
          rows={summary.byHour}
          emptyLabel="Sem métricas coletadas ainda."
        />
      </div>
    </div>
  );
}
