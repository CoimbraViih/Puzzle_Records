import { EDIT_STATUS_LABEL, isCutProBusy } from "@/lib/cutpro/labels";

type EditStatus = keyof typeof EDIT_STATUS_LABEL;

/** "há Xmin"/"há Xh"/"há Xh Ymin" a partir de `updatedAt` até agora — cálculo
 * simples no render (sem interval/polling), como pedido no brief da Task 2. */
function formatElapsed(updatedAt: string): string | null {
  const updatedMs = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedMs)) return null;

  const diffMinutes = Math.max(0, Math.round((Date.now() - updatedMs) / 60_000));
  if (diffMinutes < 1) return "há poucos segundos";
  if (diffMinutes < 60) return `há ${diffMinutes}min`;

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return minutes > 0 ? `há ${hours}h ${minutes}min` : `há ${hours}h`;
}

/**
 * Rótulo de edit_status compartilhado entre drive-item-card.tsx e
 * post-card.tsx (M20/quadro de renderização): nos 3 estados transitórios do
 * pipeline Cut.Pro (enviando/clipando/renderizando), mostra uma barra de
 * progresso além do rótulo + tempo decorrido; nos demais (nao_editado/
 * editado/erro), só o rótulo — comportamento idêntico ao texto solto que
 * existia antes.
 *
 * `renderProgress` vem de cutpro_render_progress (migration 0030, só gravado
 * durante "renderizando" — ver lib/cutpro/pipeline.ts stepRenderizando). Pode
 * ser `null` mesmo em produção com a migration já aplicada (antes do 1º ciclo
 * de polling gravar um valor, ou durante enviando/clipando, que não têm %
 * própria) — nesse caso a barra fica indeterminada (pulso), nunca "presa em
 * 0%" como se fosse informação real.
 */
export function RenderStatusBadge({
  editStatus,
  renderProgress,
  updatedAt,
  label,
}: {
  editStatus: EditStatus;
  renderProgress: number | null;
  updatedAt: string;
  /** Override do texto (ex.: post-card.tsx usa "Template: <rótulo>"). Sem
   * isso, usa o rótulo puro de EDIT_STATUS_LABEL. */
  label?: string;
}) {
  const displayLabel = label ?? EDIT_STATUS_LABEL[editStatus];

  if (!isCutProBusy(editStatus)) {
    return <p className="text-xs text-muted-foreground">{displayLabel}</p>;
  }

  const elapsed = formatElapsed(updatedAt);
  const hasProgress =
    renderProgress !== null && renderProgress !== undefined && !Number.isNaN(renderProgress);
  const clampedProgress = hasProgress
    ? Math.min(100, Math.max(0, renderProgress as number))
    : null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        {displayLabel}
        {elapsed ? ` · ${elapsed}` : ""}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedProgress ?? undefined}
        aria-label={displayLabel}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {clampedProgress !== null ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${clampedProgress}%` }}
          />
        ) : (
          // Sem % conhecida ainda (coluna null — antes da migration 0030 ser
          // aplicada em produção, ou antes do 1º ciclo de polling) — barra
          // indeterminada, nunca uma barra parada em 0%.
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/50" />
        )}
      </div>
    </div>
  );
}
