"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTemplate, updateTemplate } from "@/lib/templates/actions";
import type { VideoTemplate } from "@/lib/types/template";

interface TemplateFormDialogProps {
  mode: "create" | "edit";
  template?: VideoTemplate;
}

export function TemplateFormDialog({ mode, template }: TemplateFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const config = template?.config;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createTemplate(formData)
          : await updateTemplate(template!.id, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        {mode === "create" ? "Novo template" : "Editar"}
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogTitle>{mode === "create" ? "Novo template" : `Editar ${template?.name}`}</DialogTitle>

        <form action={handleSubmit} className="flex flex-col gap-3">

            <label className="text-sm">
              Nome
              <input name="name" defaultValue={template?.name} required className="mt-1 w-full rounded border border-border bg-background p-2" />
            </label>

            <label className="text-sm">
              Cor da caixa de título
              <input name="titleBoxColor" type="color" defaultValue={config?.titleBox.color ?? "#96DB12"} className="mt-1 w-full" />
            </label>

            <label className="text-sm">
              Cor do texto do título
              <input name="titleBoxTextColor" type="color" defaultValue={config?.titleBox.textColor ?? "#000000"} className="mt-1 w-full" />
            </label>

            <label className="text-sm">
              Posição do título
              <select name="titleBoxPosition" defaultValue={config?.titleBox.position ?? "bottom-third"} className="mt-1 w-full rounded border border-border bg-background p-2">
                <option value="bottom-third">Terço inferior</option>
                <option value="top-third">Terço superior</option>
              </select>
            </label>

            <label className="text-sm">
              Duração do título (segundos)
              <input name="titleBoxDuration" type="number" min={1} max={10} defaultValue={config?.titleBox.durationSeconds ?? 3} className="mt-1 w-full rounded border border-border bg-background p-2" />
            </label>

            <label className="text-sm">
              Estilo de legenda
              <select name="captionStyle" defaultValue={config?.captionStyle ?? "viral"} className="mt-1 w-full rounded border border-border bg-background p-2">
                <option value="viral">Viral (palavra destacada)</option>
                <option value="classico">Clássico</option>
                <option value="karaoke">Karaokê</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input name="logoEnabled" type="checkbox" defaultChecked={config?.logo.enabled ?? true} />
              Logo ligada
            </label>

            <label className="text-sm">
              Posição da logo
              <select name="logoPosition" defaultValue={config?.logo.position ?? "top-right"} className="mt-1 w-full rounded border border-border bg-background p-2">
                <option value="top-right">Canto superior direito</option>
                <option value="top-left">Canto superior esquerdo</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input name="progressBarEnabled" type="checkbox" defaultChecked={config?.progressBar.enabled ?? true} />
              Barra de progresso ligada
            </label>

            <label className="text-sm">
              Cor da barra de progresso
              <input name="progressBarColor" type="color" defaultValue={config?.progressBar.color ?? "#96DB12"} className="mt-1 w-full" />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input name="footerEnabled" type="checkbox" defaultChecked={config?.footer.enabled ?? false} />
              Rodapé ligado
            </label>

            <label className="text-sm">
              Texto do rodapé
              <input name="footerText" defaultValue={config?.footer.text ?? "SIGA @puzzlerecordss"} className="mt-1 w-full rounded border border-border bg-background p-2" />
            </label>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
