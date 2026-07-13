import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VideoTemplateConfig } from "../remotion/templateConfig";
import type { WordTimestamp } from "../remotion/captions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RenderJobInput {
  postId: string;
  videoUrl: string;
  headline: string;
  words: WordTimestamp[];
  config: VideoTemplateConfig;
  logoUrl: string;
}

let bundleLocationPromise: Promise<string> | null = null;

function getBundleLocation(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle({
      entryPoint: path.join(__dirname, "../remotion/index.ts"),
    });
  }
  return bundleLocationPromise;
}

/**
 * Renderiza o vídeo final com o template Puzzle v1 e devolve o caminho
 * absoluto do MP4 gerado no filesystem local do worker — quem chama
 * (index.ts) é responsável por subir esse arquivo pro Storage e limpá-lo.
 */
export async function renderVideoJob(input: RenderJobInput): Promise<string> {
  const serveUrl = await getBundleLocation();
  const durationInFrames = 900;

  const composition = await selectComposition({
    serveUrl,
    id: "PuzzleTemplateV1",
    inputProps: {
      videoUrl: input.videoUrl,
      headline: input.headline,
      words: input.words,
      config: input.config,
      logoUrl: input.logoUrl,
      durationInFrames,
    },
  });

  const outputLocation = path.join("/tmp", `puzzle-${input.postId}-${Date.now()}.mp4`);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps: {
      videoUrl: input.videoUrl,
      headline: input.headline,
      words: input.words,
      config: input.config,
      logoUrl: input.logoUrl,
      durationInFrames,
    },
  });

  return outputLocation;
}
