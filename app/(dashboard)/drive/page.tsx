import { PageHeader } from "@/components/dashboard/page-header";
import { DriveItemCard } from "@/components/drive/drive-item-card";
import { DriveRefreshButton } from "@/components/drive/drive-refresh-button";
import { ManualPostDialog } from "@/components/drive/manual-post-dialog";
import { listDriveItems } from "@/lib/drive/queries";
import { listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function DrivePage() {
  const [items, socialAccounts] = await Promise.all([
    listDriveItems(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Drive"
        description="Espelho da pasta do Google Drive — gere legenda, edite vídeo com o template da casa e envie para a fila de aprovação."
        actions={
          <div className="flex gap-2">
            <ManualPostDialog socialAccounts={socialAccounts} />
            <DriveRefreshButton />
          </div>
        }
      />

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum arquivo na pasta ainda. Suba imagem ou vídeo na pasta do Google Drive
          e clique em &quot;Atualizar agora&quot;.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <DriveItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
