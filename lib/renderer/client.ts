import { readFile } from "node:fs/promises";
import path from "node:path";

export interface RenderFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let cachedFonts: RenderFont[] | null = null;
let cachedLogoDataUri: string | null = null;

export async function loadFonts(): Promise<RenderFont[]> {
  if (cachedFonts) return cachedFonts;

  const fontsDir = path.join(process.cwd(), "lib/renderer/fonts");
  const [interBold, antonRegular] = await Promise.all([
    readFile(path.join(fontsDir, "Inter-Bold.ttf")),
    readFile(path.join(fontsDir, "Anton-Regular.ttf")),
  ]);

  cachedFonts = [
    { name: "Inter", data: interBold, weight: 700, style: "normal" },
    { name: "Anton", data: antonRegular, weight: 400, style: "normal" },
  ];
  return cachedFonts;
}

export async function loadLogoDataUri(): Promise<string> {
  if (cachedLogoDataUri) return cachedLogoDataUri;

  const svgPath = path.join(process.cwd(), "puzzle-records-logo.svg");
  const svg = await readFile(svgPath, "utf-8");
  cachedLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return cachedLogoDataUri;
}
