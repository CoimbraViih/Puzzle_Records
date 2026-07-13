import { describe, expect, it } from "vitest";
import { groupWordsIntoCaptionLines } from "./captions";

describe("groupWordsIntoCaptionLines", () => {
  it("agrupa palavras em linhas de até maxWordsPerLine, convertendo segundos para frames a 30fps", () => {
    const words = [
      { word: "vai", start: 0, end: 0.3 },
      { word: "dar", start: 0.3, end: 0.5 },
      { word: "onda", start: 0.5, end: 0.9 },
      { word: "hoje", start: 0.9, end: 1.2 },
    ];

    const lines = groupWordsIntoCaptionLines(words, 3);

    expect(lines).toHaveLength(2);
    expect(lines[0].words.map((w) => w.word)).toEqual(["vai", "dar", "onda"]);
    expect(lines[0].startFrame).toBe(0);
    expect(lines[0].endFrame).toBe(27); // 0.9s * 30fps
    expect(lines[1].words.map((w) => w.word)).toEqual(["hoje"]);
    expect(lines[1].startFrame).toBe(27);
    expect(lines[1].endFrame).toBe(36); // 1.2s * 30fps
  });

  it("retorna lista vazia para entrada vazia", () => {
    expect(groupWordsIntoCaptionLines([], 3)).toEqual([]);
  });

  it("usa 4 como maxWordsPerLine padrão quando não informado", () => {
    const words = Array.from({ length: 5 }, (_, i) => ({
      word: `p${i}`,
      start: i,
      end: i + 1,
    }));

    const lines = groupWordsIntoCaptionLines(words);

    expect(lines[0].words).toHaveLength(4);
    expect(lines[1].words).toHaveLength(1);
  });
});
