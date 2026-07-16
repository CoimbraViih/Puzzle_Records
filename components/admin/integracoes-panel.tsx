import { Button } from "@/components/ui/button";
import { getCutProProvider } from "@/lib/cutpro";

async function getCutProBalanceLabel(): Promise<string> {
  if (!process.env.CUTPRO_API_KEY) {
    return "Não conectado — CUTPRO_API_KEY ausente.";
  }
  try {
    const { balance } = await getCutProProvider().getBalance();
    return `Conectado — ${balance} créditos disponíveis.`;
  } catch (err) {
    console.error("Falha ao consultar saldo Cut.Pro em /admin/integracoes:", err);
    return "Conectado, mas não foi possível consultar o saldo agora.";
  }
}

export default async function IntegracoesPanel() {
  const isConnected = Boolean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  const cutproLabel = await getCutProBalanceLabel();

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
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

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-foreground">Cut.Pro</h3>
            <p className="text-sm text-muted-foreground">{cutproLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
