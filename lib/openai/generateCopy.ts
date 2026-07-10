import { createOpenAIClient, getAiProvider } from "./client";
import { buildTextUserPrompt, buildVideoUserContent, SYSTEM_PROMPT } from "./prompts";
import { analyzeVideo } from "./videoAnalysis";
import type { CopyVariation, PostType } from "@/lib/types/post";

const OPENAI_ROUTINE_MODEL = "gpt-4o-mini";
const OPENAI_LAUNCH_MODEL = "gpt-4o";

// Modelos gratuitos do OpenRouter (só para teste, ver lib/openai/client.ts).
const OPENROUTER_ROUTINE_MODEL =
  process.env.OPENROUTER_MODEL_ROUTINE ?? "openai/gpt-oss-20b:free";
const OPENROUTER_LAUNCH_MODEL =
  process.env.OPENROUTER_MODEL_LAUNCH ?? OPENROUTER_ROUTINE_MODEL;

export class CopyGenerationError extends Error {}

function modelForPostType(postType: PostType): string {
  const isLaunch = postType === "lancamento";
  if (getAiProvider() === "openrouter") {
    return isLaunch ? OPENROUTER_LAUNCH_MODEL : OPENROUTER_ROUTINE_MODEL;
  }
  return isLaunch ? OPENAI_LAUNCH_MODEL : OPENAI_ROUTINE_MODEL;
}

function parseVariations(raw: string): CopyVariation[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CopyGenerationError("Resposta da OpenAI não é um JSON válido.");
  }

  const variations = (json as { variations?: unknown }).variations;
  if (!Array.isArray(variations) || variations.length === 0) {
    throw new CopyGenerationError("Resposta da OpenAI sem variações.");
  }

  return variations.map((item, index) => {
    const headline = (item as { headline?: unknown } | null)?.headline;
    const caption = (item as { caption?: unknown } | null)?.caption;
    if (typeof headline !== "string" || typeof caption !== "string") {
      throw new CopyGenerationError(
        `Variação ${index + 1} da OpenAI com formato inválido.`
      );
    }
    return { headline: headline.trim(), caption: caption.trim() };
  });
}

export type GenerateCopyInput =
  | { mode: "text"; postType: PostType; fact: string; trackName: string | null }
  | {
      mode: "video";
      postType: PostType;
      trackName: string | null;
      additionalContext: string | null;
      videoBuffer: Buffer;
      filename: string;
    };

/**
 * Gera 2-3 variações de manchete/legenda pro post. Modo "text" usa o
 * contexto digitado/vindo do Drive; modo "video" analisa o próprio vídeo
 * (frames + transcrição, ver videoAnalysis.ts) — não depende de texto de
 * contexto, mas aproveita `additionalContext` se presente. Lança
 * CopyGenerationError (ou erro do SDK/ffmpeg) em caso de falha — quem
 * chama decide como registrar, nunca falha em silêncio.
 */
export async function generateCopyVariations(
  input: GenerateCopyInput
): Promise<CopyVariation[]> {
  const client = createOpenAIClient();
  const model = modelForPostType(input.postType);
  const responseFormat =
    getAiProvider() === "openai"
      ? ({ response_format: { type: "json_object" as const } } as const)
      : {};

  const userContent =
    input.mode === "text"
      ? buildTextUserPrompt(input)
      : buildVideoUserContent({
          postType: input.postType,
          trackName: input.trackName,
          additionalContext: input.additionalContext,
          ...(await analyzeVideo(input.videoBuffer, input.filename)),
        });

  const completion = await client.chat.completions.create({
    model,
    ...responseFormat,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new CopyGenerationError("OpenAI retornou resposta vazia.");
  }

  return parseVariations(content);
}
