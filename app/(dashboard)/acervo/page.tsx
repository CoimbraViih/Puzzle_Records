import { AcervoFormDialog } from "@/components/acervo/acervo-form-dialog";
import { FilterableAcervoBoard } from "@/components/acervo/filterable-acervo-board";
import { PageHeader } from "@/components/dashboard/page-header";
import { listAcervoPosts } from "@/lib/acervo/queries";
import { listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function AcervoPage() {
  const [posts, socialAccounts] = await Promise.all([
    listAcervoPosts(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Acervo"
        description="Conteúdo já produzido, agendado automaticamente para manter o perfil ativo."
        actions={
          <AcervoFormDialog socialAccounts={socialAccounts} />
        }
      />

      <FilterableAcervoBoard
        posts={posts}
        socialAccounts={socialAccounts}
      />
    </div>
  );
}
