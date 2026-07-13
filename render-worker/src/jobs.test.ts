import { describe, expect, it, vi } from "vitest";
import { createJobStore } from "./jobs";

describe("createJobStore", () => {
  it("cria um job em processing e resolve pra done quando a execução termina", async () => {
    const store = createJobStore();
    const jobId = store.create();

    expect(store.get(jobId)).toEqual({ status: "processing" });

    await store.run(jobId, async () => "path/output.mp4");

    expect(store.get(jobId)).toEqual({ status: "done", outputUrl: "path/output.mp4" });
  });

  it("marca o job como error quando a execução lança", async () => {
    const store = createJobStore();
    const jobId = store.create();

    await store.run(jobId, async () => {
      throw new Error("falha no render");
    });

    expect(store.get(jobId)).toEqual({ status: "error", error: "falha no render" });
  });

  it("get retorna undefined para jobId desconhecido", () => {
    const store = createJobStore();
    expect(store.get("inexistente")).toBeUndefined();
  });
});
