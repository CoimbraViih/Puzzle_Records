// Hosts reais confirmados testando a API de ponta a ponta com a chave real
// em 15/07/2026 (ver docs/plans/2026-07-15-m16-drive-cutpro.md) — "cutpro.io"/
// "api.cutpro.io" (chute inicial do D1) nunca foram os hosts corretos.
// startUpload devolve uma URL presignada de S3 (host varia por região do
// bucket, hoje us-east-1); getRenderDownloadUrl devolve um link do CDN deles.
const CUTPRO_HOST_ALLOWLIST = ["cutpro-storage.s3.us-east-1.amazonaws.com", "cdn.cut.pro"];

export function isAllowedTransferHost(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return CUTPRO_HOST_ALLOWLIST.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

export async function relayUploadToCutPro(
  sourceUrl: string,
  uploadUrl: string
): Promise<void> {
  if (!isAllowedTransferHost(uploadUrl)) {
    throw new Error(`Host de upload não permitido: ${uploadUrl}`);
  }
  const sourceResponse = await fetch(sourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`Falha ao baixar mídia de origem (status ${sourceResponse.status}).`);
  }
  const bytes = await sourceResponse.arrayBuffer();
  const contentType = sourceResponse.headers.get("content-type") ?? "application/octet-stream";

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: Buffer.from(bytes),
  });
  if (!uploadResponse.ok) {
    throw new Error(`Cut.Pro recusou o upload (status ${uploadResponse.status}).`);
  }
}
