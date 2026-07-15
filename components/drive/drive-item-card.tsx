import { FileVideo } from "lucide-react";

import type { DriveItemRow } from "@/lib/drive/queries";

const EDIT_STATUS_LABEL: Record<DriveItemRow["edit_status"], string> = {
  nao_editado: "Não editado",
  enviando: "Enviando pro Cut.Pro…",
  clipando: "Clipando…",
  aplicando: "Aplicando template…",
  renderizando: "Renderizando…",
  editado: "Editado",
  erro: "Erro na edição",
};

export function DriveItemCard({ item }: { item: DriveItemRow }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {item.media_type === "video" ? <FileVideo className="size-4" /> : null}
        <span className="truncate">{item.filename}</span>
      </div>
      {item.removed_from_drive ? (
        <p className="text-xs text-destructive">Removido do Drive (histórico preservado)</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {item.caption ? "Legenda pronta" : "Sem legenda ainda"}
        {item.media_type === "video" ? ` · ${EDIT_STATUS_LABEL[item.edit_status]}` : ""}
      </p>
      {item.post_id ? (
        <p className="text-xs text-primary">Enviado para aprovação</p>
      ) : null}
    </div>
  );
}
