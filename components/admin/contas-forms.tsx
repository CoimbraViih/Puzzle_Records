"use client";

import { useActionState } from "react";

import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ZernioAccount } from "@/lib/publishing";
import { SOCIAL_NETWORK_LABELS } from "@/lib/types/social-account";

import {
  addSocialAccountFromZernio,
  deleteSocialAccount,
  updateZernioAccountId,
  type SocialAccountFormState,
} from "@/components/admin/contas-actions";

const initialState: SocialAccountFormState = undefined;

/**
 * Os 3 forms desta tela (adicionar via Zernio, salvar zernio_account_id,
 * excluir conta) usavam `<form action={...}>` puro sem useActionState — a
 * tela voltava ao normal como se tivesse dado certo mesmo quando a action
 * falhava (achado da auditoria de produto de 29/07/2026). Mesmo padrão já
 * usado em SocialAccountForm/PostFormDialog: useActionState + SubmitButton
 * pro loading, erro mostrado na tela em vez de só console.error.
 */
export function ZernioAddAccountForm({ account }: { account: ZernioAccount }) {
  const [state, formAction] = useActionState(addSocialAccountFromZernio, initialState);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center gap-3">
        <input type="hidden" name="network" value={account.network} />
        <input type="hidden" name="handle" value={account.username} />
        <input type="hidden" name="display_name" value={account.displayName} />
        <input type="hidden" name="zernio_account_id" value={account.id} />
        {account.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.profilePictureUrl}
            alt={account.displayName}
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
            {SOCIAL_NETWORK_LABELS[account.network][0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{account.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {SOCIAL_NETWORK_LABELS[account.network]} · @{account.username}
            {!account.isActive && " · inativa"}
          </p>
        </div>
        <SubmitButton size="sm" pendingLabel="Adicionando...">
          Adicionar
        </SubmitButton>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function ZernioAccountIdForm({
  accountId,
  defaultValue,
}: {
  accountId: string;
  defaultValue: string;
}) {
  const boundAction = updateZernioAccountId.bind(null, accountId);
  const [state, formAction] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Input
          name="zernio_account_id"
          defaultValue={defaultValue}
          placeholder="—"
          className="w-32 text-xs"
        />
        <SubmitButton variant="ghost" size="sm" pendingLabel="Salvando...">
          Salvar
        </SubmitButton>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function DeleteAccountForm({ accountId }: { accountId: string }) {
  const boundAction = deleteSocialAccount.bind(null, accountId);
  const [state, formAction] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        pendingLabel="Excluindo..."
        confirmMessage="Excluir esta conta social? Posts vinculados deixarão de referenciá-la."
      >
        Excluir
      </ConfirmSubmitButton>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
