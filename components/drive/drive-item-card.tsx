import { FileVideo } from "lucide-react";

import { EditWithTemplateButton } from "@/components/drive/edit-with-template-button";
import { GenerateCaptionButton } from "@/components/drive/generate-caption-button";
import { SendToApprovalButton } from "@/components/drive/send-to-approval-button";
import { SetContextButton } from "@/components/drive/set-context-button";
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
  const previewUrl = item.edited_media_signed_url ?? item.media_signed_url;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {previewUrl && item.media_type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={item.filename}
          className="h-40 w-full rounded-md border border-border object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : previewUrl && item.media_type === "video" ? (
        <video
          src={previewUrl}
          controls
          preload="metadata"
          className="h-40 w-full rounded-md border border-border object-cover"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          Mídia ainda não disponível
        </div>
      )}
      <div className="flex items-center gap-2 text-sm font-medium">
        {item.media_type === "video" ? <FileVideo className="size-4 shrink-0" /> : null}
        <span className="truncate">{item.filename}</span>
      </div>
      {item.removed_from_drive ? (
        <p className="text-xs text-destructive">Removido do Drive (histórico preservado)</p>
      ) : null}
      {item.mirror_error ? (
        <p className="text-xs text-destructive">Erro ao sincronizar: {item.mirror_error}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {item.caption ? "Legenda pronta" : "Sem legenda ainda"}
        {item.media_type === "video" ? ` · ${EDIT_STATUS_LABEL[item.edit_status]}` : ""}
      </p>
      {item.post_id ? (
        <p className="text-xs text-primary">Enviado para aprovação</p>
      ) : null}
      {!item.post_id ? (
        <>
          <div className="flex flex-wrap gap-2">
            <SetContextButton driveItemId={item.id} currentContext={item.source_fact} />
            <GenerateCaptionButton driveItemId={item.id} />
          </div>
          {item.media_type === "image" && !item.source_fact ? (
            <p className="text-xs text-muted-foreground">
              Imagem sem contexto — clique em &quot;Criar contexto&quot; antes de gerar a legenda.
            </p>
          ) : null}
          {item.caption_error ? (
            <p className="text-xs text-destructive">{item.caption_error}</p>
          ) : null}
          {item.caption ? (
            <p className="line-clamp-3 text-xs text-foreground">{item.caption}</p>
          ) : null}
          {item.media_type === "video" &&
          (item.edit_status === "nao_editado" || item.edit_status === "erro") ? (
            <EditWithTemplateButton driveItemId={item.id} />
          ) : null}
          {item.cutpro_error ? <p className="text-xs text-destructive">{item.cutpro_error}</p> : null}
          {item.caption ? <SendToApprovalButton driveItemId={item.id} /> : null}
        </>
      ) : null}
    </div>
  );
}
