"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { duplicateTemplate } from "@/lib/templates/actions";
import { TemplateFormDialog } from "./template-form-dialog";
import type { VideoTemplate } from "@/lib/types/template";

export function TemplateCard({ template }: { template: VideoTemplate }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{template.name}</h3>
        {template.is_default && (
          <span className="rounded bg-[#96DB12] px-2 py-0.5 text-xs font-semibold text-black">Default</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <dt>Legenda</dt>
        <dd>{template.config.captionStyle}</dd>
        <dt>Título</dt>
        <dd>{template.config.titleBox.position}</dd>
        <dt>Logo</dt>
        <dd>{template.config.logo.enabled ? "ligada" : "desligada"}</dd>
        <dt>Progresso</dt>
        <dd>{template.config.progressBar.enabled ? "ligada" : "desligada"}</dd>
      </dl>
      <div className="flex gap-2">
        <TemplateFormDialog mode="edit" template={template} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => void duplicateTemplate(template.id))}
        >
          Duplicar
        </Button>
      </div>
    </div>
  );
}
