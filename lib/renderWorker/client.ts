import type { VideoTemplateConfig } from "@/lib/types/template";
import type { WordTimestamp } from "@/lib/openai/videoAnalysis";

export class RenderWorkerError extends Error {}

interface SubmitRenderJobInput {
  postId: string;
  videoUrl: string;
  headline: string;
  words: WordTimestamp[];
  config: VideoTemplateConfig;
  logoUrl: string;
}

function getWorkerConfig(): { url: string; secret: string } {
  const url = process.env.RENDER_WORKER_URL;
  const secret = process.env.RENDER_WORKER_SECRET;
  if (!url || !secret) {
    throw new RenderWorkerError(
      "RENDER_WORKER_URL ou RENDER_WORKER_SECRET não configurados."
    );
  }
  return { url, secret };
}

export async function submitRenderJob(
  input: SubmitRenderJobInput
): Promise<{ jobId: string }> {
  const { url, secret } = getWorkerConfig();

  const response = await fetch(`${url}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(input),
  });

  if (response.status !== 202) {
    throw new RenderWorkerError(
      `Falha ao submeter job de render (status ${response.status}).`
    );
  }

  return (await response.json()) as { jobId: string };
}

export type RenderJobStatus =
  | { status: "processing" }
  | { status: "done"; videoBase64: string }
  | { status: "error"; error: string };

export async function getRenderJobStatus(jobId: string): Promise<RenderJobStatus> {
  const { url, secret } = getWorkerConfig();

  const response = await fetch(`${url}/render/${jobId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (response.status === 404) {
    throw new RenderWorkerError(`Job de render ${jobId} não encontrado no worker.`);
  }
  if (!response.ok) {
    throw new RenderWorkerError(`Falha ao consultar status do job ${jobId} (status ${response.status}).`);
  }

  return (await response.json()) as RenderJobStatus;
}
