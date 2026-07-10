"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { createAcervoPost, type AcervoFormState } from "@/lib/acervo/actions";
import type { SocialAccount } from "@/lib/types/social-account";

const initialState: AcervoFormState = undefined;

export function AcervoFormDialog({
  socialAccounts,
}: {
  socialAccounts: SocialAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createAcervoPost,
    initialState
  );

  const instagramAccounts = socialAccounts.filter(
    (account) => account.network === "instagram"
  );

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setOpen(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Adicionar ao acervo
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Adicionar ao acervo
            </h2>

            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="social_account_id"
                  className="text-sm text-muted-foreground"
                >
                  Conta social (Instagram)
                </label>
                <select
                  id="social_account_id"
                  name="social_account_id"
                  required
                  defaultValue=""
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {instagramAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.display_name}
                    </option>
                  ))}
                </select>
                {instagramAccounts.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma conta Instagram cadastrada em /admin/contas.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="caption"
                  className="text-sm text-muted-foreground"
                >
                  Legenda
                </label>
                <textarea
                  id="caption"
                  name="caption"
                  required
                  rows={4}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="media"
                  className="text-sm text-muted-foreground"
                >
                  Mídia (imagem ou vídeo, já pronta para publicar)
                </label>
                <input
                  id="media"
                  name="media"
                  type="file"
                  accept="image/*,video/*"
                  required
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
                <Button type="submit" disabled={pending}>
                  {pending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
