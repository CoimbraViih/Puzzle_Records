import { AcervoBoard } from "@/components/acervo/acervo-board";
import { AcervoFormDialog } from "@/components/acervo/acervo-form-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { listAcervoPosts } from "@/lib/acervo/queries";
import { listArtists, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function AcervoPage() {
  const [posts, artists, socialAccounts] = await Promise.all([
    listAcervoPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Acervo"
        description="Conteúdo já produzido, agendado automaticamente para manter o perfil ativo."
        actions={
          <AcervoFormDialog artists={artists} socialAccounts={socialAccounts} />
        }
      />

      <AcervoBoard posts={posts} />
    </div>
  );
}
