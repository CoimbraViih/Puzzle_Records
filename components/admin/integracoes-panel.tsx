import { Button } from "@/components/ui/button";
import { getCutProProvider } from "@/lib/cutpro";
import { createDriveClient } from "@/lib/drive/client";

async function getCutProBalanceLabel(): Promise<string> {
  if (!process.env.CUTPRO_API_KEY) {
    return "Não conectado — CUTPRO_API_KEY ausente.";
  }
  try {
    const { balance } = await getCutProProvider().getBalance();
    return `Conectado — ${balance} créditos disponíveis.`;
  } catch (err) {
    console.error("Falha ao consultar saldo Cut.Pro em /admin (aba Integrações):", err);
    return "Conectado, mas não foi possível consultar o saldo agora.";
  }
}

/**
 * Antes só checava se GOOGLE_OAUTH_REFRESH_TOKEN existia (env var presente
 * não significa token válido — revogar o acesso em myaccount.google.com
 * deixava o painel dizendo "Conectado" enquanto o cron drive-sync falhava
 * silencioso nos logs). Agora faz uma chamada real (about.get) pra
 * confirmar que o refresh token ainda funciona, mesmo padrão já usado
 * acima pro saldo do Cut.Pro.
 */
async function getGoogleDriveStatusLabel(): Promise<{ connected: boolean; label: string }> {
  if (!process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return { connected: false, label: "Não conectado — GOOGLE_OAUTH_REFRESH_TOKEN ausente." };
  }
  try {
    const drive = createDriveClient();
    const { data } = await drive.about.get({ fields: "user" });
    const email = data.user?.emailAddress;
    return {
      connected: true,
      label: email ? `Conectado — autenticado como ${email}.` : "Conectado.",
    };
  } catch (err) {
    console.error("Falha ao validar conexão do Google Drive em /admin (aba Integrações):", err);
    return {
      connected: false,
      label: "Token configurado, mas inválido ou revogado — reconecte.",
    };
  }
}

export default async function IntegracoesPanel() {
  const { connected: isConnected, label: driveLabel } = await getGoogleDriveStatusLabel();
  const cutproLabel = await getCutProBalanceLabel();

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-foreground">Google Drive</h3>
            <p className="text-sm text-muted-foreground">{driveLabel}</p>
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
