import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

import { CutProError } from "./types";

const execFileAsync = promisify(execFile);

export interface VideoProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Sem ffprobe no bundle (só ffmpeg-static) — extrai duração/resolução do
 * stderr do próprio ffmpeg (`-f null -`, mesmo binário já usado por
 * lib/openai/videoAnalysis.ts para extrair frames). completeUpload() do
 * Cut.Pro exige esses 3 campos no corpo da requisição.
 */
export async function probeVideo(videoBuffer: Buffer, extension: string): Promise<VideoProbeResult> {
  if (!ffmpegPath) {
    throw new CutProError("Binário do ffmpeg não encontrado (ffmpeg-static não resolveu pra essa plataforma).");
  }

  const dir = await mkdtemp(join(tmpdir(), "cutpro-probe-"));
  const videoPath = join(dir, `input.${extension}`);
  await writeFile(videoPath, videoBuffer);

  try {
    let stderr = "";
    try {
      const result = await execFileAsync(ffmpegPath, ["-i", videoPath, "-f", "null", "-"]);
      stderr = result.stderr;
    } catch (err) {
      // ffmpeg sai com código != 0 quando não há stream de saída explícito
      // em algumas builds, mas ainda escreve as infos de duração/resolução
      // no stderr antes de falhar — usa o stderr do erro se disponível.
      stderr = (err as { stderr?: string }).stderr ?? "";
      if (!stderr) throw err;
    }

    const durationMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    const resolutionMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);

    if (!durationMatch || !resolutionMatch) {
      throw new CutProError("Não foi possível extrair duração/resolução do vídeo via ffmpeg.");
    }

    const hours = Number(durationMatch[1]);
    const minutes = Number(durationMatch[2]);
    const seconds = Number(durationMatch[3]);
    const durationSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);

    return {
      durationSeconds,
      width: Number(resolutionMatch[1]),
      height: Number(resolutionMatch[2]),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
