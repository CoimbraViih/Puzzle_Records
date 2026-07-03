import { Button } from "@/components/ui/button";
import { listSocialAccounts } from "@/lib/posts/queries";
import { SOCIAL_NETWORK_LABELS } from "@/lib/types/social-account";

import { deleteSocialAccount } from "./actions";
import { SocialAccountForm } from "./social-account-form";

export const dynamic = "force-dynamic";

export default async function ContasPage() {
  const accounts = await listSocialAccounts();

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Contas sociais</h1>

      <SocialAccountForm />

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">Rede</th>
            <th className="py-2">Handle</th>
            <th className="py-2">Nome</th>
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
              <td className="py-2 text-right">
                <form action={deleteSocialAccount.bind(null, account.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Excluir
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
