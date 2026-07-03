import { createOpenAIClient } from "./client";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompts";
import type { CopyVariation, PostType } from "@/lib/types/post";

const ROUTINE_MODEL = "gpt-4o-mini";
const LAUNCH_MODEL = "gpt-4o";

export class CopyGenerationError extends Error {}

function modelForPostType(postType: PostType): string {
  return postType === "lancamento" ? LAUNCH_MODEL : ROUTINE_MODEL;
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

/**
 * Gera 2-3 variações de manchete/legenda pro post. Lança CopyGenerationError
 * (ou erro do SDK da OpenAI) em caso de falha — quem chama decide como
 * registrar (ver app/api/cron/generate-copy/route.ts), nunca falha em
 * silêncio.
 */
export async function generateCopyVariations(input: {
  postType: PostType;
  fact: string;
  trackName: string | null;
  artistName: string | null;
  artistHandle: string | null;
}): Promise<CopyVariation[]> {
  const client = createOpenAIClient();
  const model = modelForPostType(input.postType);

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new CopyGenerationError("OpenAI retornou resposta vazia.");
  }

  return parseVariations(content);
}
