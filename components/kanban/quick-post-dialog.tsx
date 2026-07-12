"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { createPostWithAI, type PostFormState } from "@/lib/posts/actions";
import {
  POST_TEMPLATES,
  POST_TYPE_LABELS,
  POST_TYPES,
} from "@/lib/types/post";
import {
  SOCIAL_NETWORK_LABELS,
  type SocialAccount,
} from "@/lib/types/social-account";

const initialState: PostFormState = undefined;

export function QuickPostDialog({
  socialAccounts,
}: {
  socialAccounts: SocialAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createPostWithAI,
    initialState
  );
  const [isVideo, setIsVideo] = useState(false);

  // Fecha o modal quando o post é salvo com sucesso. Ajuste de estado
  // durante a renderização (guardado por `handledState`) em vez de
  // useEffect, seguindo o padrão recomendado pelo React para reagir a uma
  // mudança de state sem side effect assíncrono.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setOpen(false);
      setIsVideo(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Post rápido
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Post rápido
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Envie a mídia direto pelo painel — a IA gera a manchete e a
              legenda automaticamente.
            </p>

            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="quick_social_account_id"
                  className="text-sm text-muted-foreground"
                >
                  Conta social
                </label>
                <select
                  id="quick_social_account_id"
                  name="social_account_id"
                  required
                  defaultValue=""
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
                {!isVideo && (
                  <div className="flex flex-1 flex-col gap-1.5">
                    <label
                      htmlFor="quick_template"
                      className="text-sm text-muted-foreground"
                    >
                      Template
                    </label>
                    <select
                      id="quick_template"
                      name="template"
                      required
                      defaultValue=""
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
                )}

                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="quick_post_type"
                    className="text-sm text-muted-foreground"
                  >
                    Tipo
                  </label>
                  <select
                    id="quick_post_type"
                    name="post_type"
                    required
                    defaultValue=""
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
                  htmlFor="quick_media"
                  className="text-sm text-muted-foreground"
                >
                  Mídia (imagem ou vídeo)
                </label>
                <input
                  id="quick_media"
                  name="media"
                  type="file"
                  accept="image/*,video/*"
                  required
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setIsVideo(Boolean(file?.type.startsWith("video/")));
                  }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="quick_context"
                  className="text-sm text-muted-foreground"
                >
                  Contexto
                </label>
                <textarea
                  id="quick_context"
                  name="context"
                  rows={4}
                  required={!isVideo}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {isVideo
                    ? "Opcional para vídeo — a IA analisa o conteúdo sozinha."
                    : "Obrigatório para imagem — a IA usa isso pra escrever a legenda."}
                </p>
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
                  {pending ? "Gerando legenda com IA..." : "Gerar post"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
