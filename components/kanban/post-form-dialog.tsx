"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { createPost, updatePost, type PostFormState } from "@/lib/posts/actions";
import {
  POST_TEMPLATES,
  POST_TYPE_LABELS,
  POST_TYPES,
  type PostWithRelations,
} from "@/lib/types/post";
import {
  SOCIAL_NETWORK_LABELS,
  type SocialAccount,
} from "@/lib/types/social-account";

const initialState: PostFormState = undefined;

export function PostFormDialog({
  mode,
  post,
  socialAccounts,
  triggerLabel,
  triggerVariant = "default",
}: {
  mode: "create" | "edit";
  post?: PostWithRelations;
  socialAccounts: SocialAccount[];
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const action = mode === "create" ? createPost : updatePost;
  const [state, formAction, pending] = useActionState(action, initialState);

  // Fecha o modal quando o post é salvo com sucesso. Ajuste de estado
  // durante a renderização (guardado por `handledState`) em vez de
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
        variant={triggerVariant}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {mode === "create" ? "Novo post" : "Editar post"}
            </h2>

            <form action={formAction} className="flex flex-col gap-4">
              {mode === "edit" && post && (
                <input type="hidden" name="post_id" value={post.id} />
              )}

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="social_account_id"
                  className="text-sm text-muted-foreground"
                >
                  Conta social
                </label>
                <select
                  id="social_account_id"
                  name="social_account_id"
                  required
                  defaultValue={post?.social_account_id ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {socialAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {SOCIAL_NETWORK_LABELS[account.network]} —{" "}
                      {account.display_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="template"
                    className="text-sm text-muted-foreground"
                  >
                    Template
                  </label>
                  <select
                    id="template"
                    name="template"
                    required
                    defaultValue={post?.template ?? ""}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TEMPLATES.map((template) => (
                      <option key={template} value={template}>
                        Template {template}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="post_type"
                    className="text-sm text-muted-foreground"
                  >
                    Tipo
                  </label>
                  <select
                    id="post_type"
                    name="post_type"
                    required
                    defaultValue={post?.post_type ?? ""}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {POST_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="headline"
                  className="text-sm text-muted-foreground"
                >
                  Manchete
                </label>
                <input
                  id="headline"
                  name="headline"
                  required
                  defaultValue={post?.headline ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
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
                  defaultValue={post?.caption ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="media" className="text-sm text-muted-foreground">
                  Mídia {mode === "edit" ? "(opcional — substitui a atual)" : ""}
                </label>
                <input
                  id="media"
                  name="media"
                  type="file"
                  accept="image/*,video/*"
                  required={mode === "create"}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="scheduled_at"
                  className="text-sm text-muted-foreground"
                >
                  Agendamento (opcional)
                </label>
                <input
                  id="scheduled_at"
                  name="scheduled_at"
                  type="datetime-local"
                  defaultValue={post?.scheduled_at?.slice(0, 16) ?? ""}
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
