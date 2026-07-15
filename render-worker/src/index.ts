import express from "express";
import { readFile, unlink } from "node:fs/promises";
import { isAllowedTransferHost, relayUploadToCutPro } from "./cutproTransfer";
import { createJobStore } from "./jobs";
import { renderVideoJob, type RenderJobInput } from "./render";

const app = express();
app.use(express.json({ limit: "10mb" }));

const jobStore = createJobStore();
const RENDER_WORKER_SECRET = process.env.RENDER_WORKER_SECRET;

function isAuthorized(req: express.Request): boolean {
  if (!RENDER_WORKER_SECRET) return false;
  return req.headers.authorization === `Bearer ${RENDER_WORKER_SECRET}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/render", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const input = req.body as RenderJobInput;
  const jobId = jobStore.create();

  void jobStore.run(jobId, async () => {
    const outputLocation = await renderVideoJob(input);
    const buffer = await readFile(outputLocation);
    await unlink(outputLocation);
    // O worker não fala com o Supabase diretamente: devolve o vídeo em
    // base64 no polling (Task 7 baixa e sobe pro Storage do lado do
    // Next.js) para manter as credenciais do Storage só num lugar.
    return buffer.toString("base64");
  });

  res.status(202).json({ jobId });
});

app.get("/render/:jobId", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const record = jobStore.get(req.params.jobId);
  if (!record) {
    res.status(404).json({ error: "job não encontrado" });
    return;
  }

  if (record.status === "done") {
    jobStore.delete(req.params.jobId);
    res.json({ status: "done", videoBase64: record.outputUrl });
    return;
  }

  if (record.status === "error") {
    jobStore.delete(req.params.jobId);
    res.json({ status: "error", error: record.error });
    return;
  }

  res.json({ status: "processing" });
});

app.post("/transfer/upload-to-cutpro", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { sourceUrl, uploadUrl } = req.body as { sourceUrl?: string; uploadUrl?: string };
  if (!sourceUrl || !uploadUrl) {
    res.status(400).json({ error: "sourceUrl e uploadUrl são obrigatórios" });
    return;
  }
  relayUploadToCutPro(sourceUrl, uploadUrl)
    .then(() => res.status(202).json({ ok: true }))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    });
});

app.get("/transfer/download-from-cutpro", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const downloadUrl = req.query.url as string | undefined;
  if (!downloadUrl || !isAllowedTransferHost(downloadUrl)) {
    res.status(400).json({ error: "url ausente ou host não permitido" });
    return;
  }
  fetch(downloadUrl)
    .then(async (upstream) => {
      if (!upstream.ok) {
        res.status(502).json({ error: `Cut.Pro retornou ${upstream.status}` });
        return;
      }
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") ?? "application/octet-stream"
      );
      res.send(Buffer.from(await upstream.arrayBuffer()));
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    });
});

const port = process.env.PORT ?? 8080;
app.listen(port, () => {
  console.log(`render-worker ouvindo na porta ${port}`);
});
