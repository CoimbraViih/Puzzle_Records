export class RenderWorkerTransferError extends Error {}

function getWorkerConfig(): { url: string; secret: string } {
  const url = process.env.RENDER_WORKER_URL;
  const secret = process.env.RENDER_WORKER_SECRET;
  if (!url || !secret) {
    throw new RenderWorkerTransferError(
      "RENDER_WORKER_URL ou RENDER_WORKER_SECRET não configurados."
    );
  }
  return { url, secret };
}

export async function relayUploadToCutPro(sourceUrl: string, uploadUrl: string): Promise<void> {
  const { url, secret } = getWorkerConfig();
  const response = await fetch(`${url}/transfer/upload-to-cutpro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ sourceUrl, uploadUrl }),
  });
  if (!response.ok) {
    throw new RenderWorkerTransferError(`Falha ao repassar upload ao Cut.Pro (status ${response.status}).`);
  }
}

export async function downloadFromCutPro(downloadUrl: string): Promise<Buffer> {
  const { url, secret } = getWorkerConfig();
  const response = await fetch(
    `${url}/transfer/download-from-cutpro?url=${encodeURIComponent(downloadUrl)}`,
    { headers: { Authorization: `Bearer ${secret}` } }
  );
  if (!response.ok) {
    throw new RenderWorkerTransferError(`Falha ao baixar render do Cut.Pro (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
