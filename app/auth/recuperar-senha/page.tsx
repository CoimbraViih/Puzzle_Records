"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { requestPasswordReset, type RecoverState } from "./actions";

const initialState: RecoverState = undefined;

export default function RecuperarSenhaPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">
          Recuperar senha
        </h1>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        {state?.message && (
          <p className="text-sm text-muted-foreground">{state.message}</p>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "Enviando..." : "Enviar link"}
        </Button>
      </form>
    </div>
  );
}
