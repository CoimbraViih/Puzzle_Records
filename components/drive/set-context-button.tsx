"use client";

import { useState, useTransition } from "react";
import { PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateDriveItemContext } from "@/lib/drive/actions";

export function SetContextButton({
  driveItemId,
  currentContext,
}: {
  driveItemId: string;
  currentContext: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(currentContext ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <PencilLine />
        {currentContext ? "Editar contexto" : "Criar contexto"}
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogTitle>Contexto para a IA</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await updateDriveItemContext(driveItemId, context);
              setError(result.error ?? null);
              if (!result.error) setOpen(false);
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="context" className="text-sm text-muted-foreground">
              Fato/contexto do post
            </label>
            <textarea
              id="context"
              name="context"
              required
              rows={4}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Ex.: DJ Fulano anuncia nova música em parceria com..."
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar contexto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
