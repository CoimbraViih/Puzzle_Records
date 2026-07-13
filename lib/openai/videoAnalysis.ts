import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

import { createOpenAIClient } from "./client";

const execFileAsync = promisify(execFile);
const FRAME_COUNT = 5;

export class VideoAnalysisError extends Error {}

/**
 * Extrai até FRAME_COUNT frames distribuídos ao longo do vídeo (1 a cada 2s,
 * redimensionados a 512px de largura pra caber no limite de payload da
 * OpenAI). Clipes curtos geram menos frames — não é erro.
 */
async function extractFrames(
  videoBuffer: Buffer,
  extension: string
): Promise<string[]> {
  if (!ffmpegPath) {
    throw new VideoAnalysisError(
      "Binário do ffmpeg não encontrado (ffmpeg-static não resolveu pra essa plataforma)."
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "puzzle-video-"));
  const videoPath = join(dir, `input.${extension}`);
  await writeFile(videoPath, videoBuffer);

  try {
    const framePattern = join(dir, "frame-%d.jpg");
    await execFileAsync(ffmpegPath, [
      "-i",
      videoPath,
      "-vf",
      "fps=1/2,scale=512:-1",
      "-frames:v",
      String(FRAME_COUNT),
      "-y",
      framePattern,
    ]);

    const frames: string[] = [];
    for (let i = 1; i <= FRAME_COUNT; i++) {
      try {
        const buf = await readFile(join(dir, `frame-${i}.jpg`));
        frames.push(buf.toString("base64"));
      } catch {
        break;
      }
    }

    if (frames.length === 0) {
      throw new VideoAnalysisError("Não foi possível extrair frames do vídeo.");
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Transcreve o áudio do vídeo via Whisper. Formatos de vídeo comuns (mp4,
 * webm, mov) são aceitos direto pela API — não precisa extrair a trilha de
 * áudio com ffmpeg à parte. Falha de transcrição não derruba a análise
 * inteira: segue só com os frames (ex.: vídeo sem áudio/fala).
 */
async function transcribeAudio(
  videoBuffer: Buffer,
  filename: string
): Promise<string | null> {
  try {
    const client = createOpenAIClient();
    const file = new File([new Uint8Array(videoBuffer)], filename);
    const transcription = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return transcription.text?.trim() || null;
  } catch (err) {
    console.error(
      "Falha ao transcrever áudio do vídeo (seguindo só com os frames):",
      err
    );
    return null;
  }
}

export interface VideoAnalysis {
  frames: string[];
  transcript: string | null;
}

export async function analyzeVideo(
  videoBuffer: Buffer,
  filename: string
): Promise<VideoAnalysis> {
  const extension = filename.split(".").pop() ?? "mp4";
  const [frames, transcript] = await Promise.all([
    extractFrames(videoBuffer, extension),
    transcribeAudio(videoBuffer, filename),
  ]);
  return { frames, transcript };
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface WhisperVerboseWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperVerboseResponse {
  words?: WhisperVerboseWord[];
}

/**
 * Transcreve com timestamp por palavra (necessário pra legenda estilo
 * karaokê/viral sincronizada). Ao contrário de transcribeAudio() (usada na
 * análise multimodal do M4/M11, onde a legenda é só um complemento e uma
 * falha não pode travar a geração de copy), aqui a transcrição é o insumo
 * principal da legenda renderizada — falha vira erro explícito.
 */
export async function transcribeWithWordTimestamps(
  videoBuffer: Buffer,
  filename: string
): Promise<WordTimestamp[]> {
  const client = createOpenAIClient();
  const file = new File([new Uint8Array(videoBuffer)], filename);

  let response: WhisperVerboseResponse;
  try {
    response = (await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    })) as unknown as WhisperVerboseResponse;
  } catch (err) {
    throw new VideoAnalysisError(
      `Falha ao transcrever áudio com timestamps por palavra: ${
        err instanceof Error ? err.message : "erro desconhecido"
      }`
    );
  }

  const words = response.words ?? [];
  if (words.length === 0) {
    throw new VideoAnalysisError(
      "Transcrição não retornou palavras com timestamp (vídeo sem áudio/fala detectável)."
    );
  }

  return words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
}
