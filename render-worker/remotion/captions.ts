export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface CaptionLine {
  words: WordTimestamp[];
  startFrame: number;
  endFrame: number;
}

const FPS = 30;
const DEFAULT_MAX_WORDS_PER_LINE = 4;

function secondsToFrame(seconds: number): number {
  return Math.round(seconds * FPS);
}

/**
 * Agrupa palavras com timestamp em linhas de legenda de até
 * maxWordsPerLine palavras, convertendo os limites de tempo (segundos,
 * como vem do Whisper) para frames (30fps, taxa de render do worker).
 */
export function groupWordsIntoCaptionLines(
  words: WordTimestamp[],
  maxWordsPerLine: number = DEFAULT_MAX_WORDS_PER_LINE
): CaptionLine[] {
  const lines: CaptionLine[] = [];

  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    const chunk = words.slice(i, i + maxWordsPerLine);
    lines.push({
      words: chunk,
      startFrame: secondsToFrame(chunk[0].start),
      endFrame: secondsToFrame(chunk[chunk.length - 1].end),
    });
  }

  return lines;
}
