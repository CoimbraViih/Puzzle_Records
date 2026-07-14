import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function IntegracoesPage() {
  const isConnected = Boolean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader title="Integrações" description="Conexões externas do painel." />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-foreground">Google Drive</h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? "Conectado — GOOGLE_OAUTH_REFRESH_TOKEN configurado."
                : "Não conectado — GOOGLE_OAUTH_REFRESH_TOKEN ausente."}
            </p>
          </div>
          <Button render={<a href="/api/admin/google-drive/authorize" />}>
            {isConnected ? "Reconectar" : "Conectar Google Drive"}
          </Button>
        </div>
      </div>
    </div>
  );
}
