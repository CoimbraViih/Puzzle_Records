"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { rejectPost, type PostFormState } from "@/lib/posts/actions";

const initialState: PostFormState = undefined;

export function RejectDialog({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    rejectPost,
    initialState
  );

  // Fecha o modal quando a rejeição é confirmada com sucesso. Ajuste de
  // estado durante a renderização (guardado por `handledState`) em vez de
  // useEffect, seguindo o padrão recomendado pelo React para reagir a uma
  // mudança de state sem side effect assíncrono.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Rejeitar
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Rejeitar post
            </h2>
            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="post_id" value={postId} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reason" className="text-sm text-muted-foreground">
                  Motivo
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  required
                  rows={3}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending ? "Rejeitando..." : "Confirmar rejeição"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
