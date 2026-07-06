"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS } from "@/lib/types/social-account";

import { createSocialAccount, type SocialAccountFormState } from "./actions";

const initialState: SocialAccountFormState = undefined;

export function SocialAccountForm() {
  const [state, formAction, pending] = useActionState(
    createSocialAccount,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="network" className="text-sm text-muted-foreground">
          Rede
        </label>
        <select
          id="network"
          name="network"
          required
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {SOCIAL_NETWORKS.map((network) => (
            <option key={network} value={network}>
              {SOCIAL_NETWORK_LABELS[network]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="handle" className="text-sm text-muted-foreground">
          @handle
        </label>
        <input
          id="handle"
          name="handle"
          required
          placeholder="@puzzlerecordss"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="display_name"
          className="text-sm text-muted-foreground"
        >
          Nome de exibição
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          placeholder="Puzzle Records"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="zernio_account_id"
          className="text-sm text-muted-foreground"
        >
          ID da conta no Zernio (opcional)
        </label>
        <input
          id="zernio_account_id"
          name="zernio_account_id"
          placeholder="Preencher depois de conectar no Zernio"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Adicionar"}
      </Button>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
