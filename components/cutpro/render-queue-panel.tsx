import { RenderStatusBadge } from "@/components/drive/render-status-badge";
import type { RenderQueueItem } from "@/lib/cutpro/renderQueue";

const SOURCE_LABEL: Record<RenderQueueItem["source"], string> = {
  drive: "Drive",
  post: "Post rápido/Acervo",
};

/**
 * Painel "Fila de renderização" (M20/quadro de renderização) — visão única
 * de tudo que está em edição com template no Cut.Pro (drive_items + posts),
 * exibido no topo de /drive e /aprovacao. Retorna `null` cedo quando não há
 * nada em edição, mesmo padrão de DailySlotsPanel
 * (components/calendar/daily-slots-panel.tsx) — não ocupa espaço com uma
 * mensagem de "vazio".
 */
export function RenderQueuePanel({ items }: { items: RenderQueueItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Fila de renderização</h3>
        <p className="text-xs text-muted-foreground">
          Itens em edição com template no Cut.Pro agora — envio pra aprovação fica bloqueado até
          terminar.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div
            key={`${item.source}-${item.id}`}
            className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-foreground">{item.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {SOURCE_LABEL[item.source]}
              </span>
            </div>
            <RenderStatusBadge
              editStatus={item.edit_status}
              renderProgress={item.cutpro_render_progress}
              updatedAt={item.updated_at}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
