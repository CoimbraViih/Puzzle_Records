import { randomUUID } from "node:crypto";

export type JobRecord =
  | { status: "processing" }
  | { status: "done"; outputUrl: string }
  | { status: "error"; error: string };

export interface JobStore {
  create(): string;
  get(jobId: string): JobRecord | undefined;
  run(jobId: string, task: () => Promise<string>): Promise<void>;
  delete(jobId: string): void;
}

/**
 * Store de jobs em memória do processo. Suficiente para o worker: cada
 * instância do Railway processa seus próprios renders, e o painel Next.js
 * nunca lê o estado diretamente — só via GET /render/:jobId (Task 6/7).
 * Se o processo reiniciar no meio de um render, o cron de submissão da
 * Task 6 não resubmete (video_render_job_id já gravado) e o polling da
 * Task 7 vai receber 404 e registrar erro explícito — não falha em
 * silêncio.
 */
export function createJobStore(): JobStore {
  const jobs = new Map<string, JobRecord>();

  return {
    create(): string {
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing" });
      return jobId;
    },
    get(jobId: string): JobRecord | undefined {
      return jobs.get(jobId);
    },
    async run(jobId: string, task: () => Promise<string>): Promise<void> {
      try {
        const outputUrl = await task();
        jobs.set(jobId, { status: "done", outputUrl });
      } catch (err) {
        jobs.set(jobId, {
          status: "error",
          error: err instanceof Error ? err.message : "erro desconhecido no render",
        });
      }
    },
    delete(jobId: string): void {
      jobs.delete(jobId);
    },
  };
}
