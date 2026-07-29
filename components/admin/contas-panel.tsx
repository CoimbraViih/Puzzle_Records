import { listSocialAccounts } from "@/lib/posts/queries";
import { listZernioAccounts } from "@/lib/publishing";
import { SOCIAL_NETWORK_LABELS } from "@/lib/types/social-account";

import {
  DeleteAccountForm,
  ZernioAccountIdForm,
  ZernioAddAccountForm,
} from "@/components/admin/contas-forms";
import { SocialAccountForm } from "@/components/admin/social-account-form";

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
          <ZernioAddAccountForm key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}

export default async function ContasPanel() {
  const accounts = await listSocialAccounts();
  const linkedZernioIds = new Set(
    accounts.map((account) => account.zernio_account_id).filter((id): id is string => Boolean(id))
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
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
                <ZernioAccountIdForm
                  accountId={account.id}
                  defaultValue={account.zernio_account_id ?? ""}
                />
              </td>
              <td className="py-2 text-right">
                <DeleteAccountForm accountId={account.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
