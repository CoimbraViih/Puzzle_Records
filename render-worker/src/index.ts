import express from "express";
import { readFile, unlink } from "node:fs/promises";
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
    res.json({ status: "done", videoBase64: record.outputUrl });
    return;
  }

  res.json(record.status === "error" ? { status: "error", error: record.error } : { status: "processing" });
});

const port = process.env.PORT ?? 8080;
app.listen(port, () => {
  console.log(`render-worker ouvindo na porta ${port}`);
});
