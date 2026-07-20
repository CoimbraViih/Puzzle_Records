"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { approvePost } from "@/lib/posts/actions";

/**
 * Aprovar com horário opcional (M21) — em branco, o post entra na fila
 * automática do cron daily-schedule (próximo horário livre configurado em
 * /calendario); preenchido, publica exatamente nesse horário, ignorando a
 * fila. Mesmo padrão de datetime-local de PostFormDialog (rotulado como
 * horário de São Paulo).
 */
export function ApproveDialog({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" />}>
        Aprovar
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogTitle>Aprovar post</DialogTitle>
        <form
          className="flex flex-col gap-4"
          action={(formData) =>
            startTransition(async () => {
              await approvePost(postId, formData);
              setOpen(false);
            })
          }
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="scheduled_at" className="text-sm text-muted-foreground">
              Horário de publicação (opcional — horário de São Paulo)
            </label>
            <input
              id="scheduled_at"
              name="scheduled_at"
              type="datetime-local"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Em branco: entra automaticamente no próximo horário livre configurado em
              Calendário.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Aprovando..." : "Confirmar aprovação"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
