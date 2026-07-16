import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/dashboard/page-header";
import { listSocialAccounts } from "@/lib/posts/queries";
import { listZernioAccounts } from "@/lib/publishing";
import { SOCIAL_NETWORK_LABELS } from "@/lib/types/social-account";

import {
  addSocialAccountFromZernio,
  deleteSocialAccount,
  updateZernioAccountId,
  updateAcervoSlots,
} from "./actions";
import { SocialAccountForm } from "./social-account-form";

export const dynamic = "force-dynamic";

async function ZernioAccountPicker({ linkedZernioIds }: { linkedZernioIds: Set<string> }) {
  let zernioAccounts;
  let error: string | null = null;
  try {
    zernioAccounts = await listZernioAccounts();
  } catch (err) {
    error = err instanceof Error ? err.message : "Falha ao consultar o Zernio.";
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Não foi possível listar as contas conectadas no Zernio agora ({error}). Use &ldquo;Adicionar
          manualmente&rdquo; abaixo, ou tente novamente mais tarde.
        </p>
      </div>
    );
  }

  const unlinked = (zernioAccounts ?? []).filter((account) => !linkedZernioIds.has(account.id));

  if (unlinked.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Todas as contas conectadas no Zernio já estão adicionadas aqui. Pra conectar outra rede,
          conecte primeiro no{" "}
          <a
            href="https://zernio.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            painel do Zernio
          </a>{" "}
          e depois atualize esta página.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Contas já conectadas no Zernio, prontas pra adicionar com um clique — nada de copiar ID.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {unlinked.map((account) => (
          <form
            key={account.id}
            action={addSocialAccountFromZernio}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
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
            <Button type="submit" size="sm">
              Adicionar
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}

export default async function ContasPage() {
  const accounts = await listSocialAccounts();
  const linkedZernioIds = new Set(
    accounts.map((account) => account.zernio_account_id).filter((id): id is string => Boolean(id))
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Contas sociais"
        description="Conecte a conta primeiro no Zernio, depois adicione aqui com um clique."
      />

      <ZernioAccountPicker linkedZernioIds={linkedZernioIds} />

      <details className="group">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          Adicionar manualmente (sem passar pelo Zernio)
        </summary>
        <div className="mt-3">
          <SocialAccountForm />
        </div>
      </details>

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">Rede</th>
            <th className="py-2">Handle</th>
            <th className="py-2">Nome</th>
            <th className="py-2">ID Zernio</th>
            <th className="py-2">Horários do acervo</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-border/50">
              <td className="py-2 text-foreground">
                {SOCIAL_NETWORK_LABELS[account.network]}
              </td>
              <td className="py-2 text-foreground">{account.handle}</td>
              <td className="py-2 text-foreground">{account.display_name}</td>
              <td className="py-2">
                <form
                  action={updateZernioAccountId.bind(null, account.id)}
                  className="flex items-center gap-3"
                >
                  <Input
                    name="zernio_account_id"
                    defaultValue={account.zernio_account_id ?? ""}
                    placeholder="—"
                    className="w-32 text-xs"
                  />
                  <Button type="submit" variant="ghost" size="sm">
                    Salvar
                  </Button>
                </form>
              </td>
              <td className="py-2">
                <form
                  action={updateAcervoSlots.bind(null, account.id)}
                  className="flex items-center gap-3"
                >
                  <Input
                    name="acervo_daily_slots"
                    defaultValue={account.acervo_daily_slots.join(", ")}
                    placeholder="09:00, 13:00, 19:00"
                    className="w-40 text-xs"
                  />
                  <Button type="submit" variant="ghost" size="sm">
                    Salvar
                  </Button>
                </form>
              </td>
              <td className="py-2 text-right">
                <form action={deleteSocialAccount.bind(null, account.id)}>
                  <ConfirmSubmitButton
                    variant="ghost"
                    size="sm"
                    confirmMessage="Excluir esta conta social? Posts vinculados deixarão de referenciá-la."
                  >
                    Excluir
                  </ConfirmSubmitButton>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
