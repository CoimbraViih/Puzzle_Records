const CUTPRO_HOST_ALLOWLIST = ["cutpro.io", "api.cutpro.io"];

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
