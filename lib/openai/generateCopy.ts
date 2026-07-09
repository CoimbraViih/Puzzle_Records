import { createOpenAIClient, getAiProvider } from "./client";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompts";
import type { CopyVariation, PostType } from "@/lib/types/post";

const OPENAI_ROUTINE_MODEL = "gpt-4o-mini";
const OPENAI_LAUNCH_MODEL = "gpt-4o";

// Modelos gratuitos do OpenRouter (só para teste, ver lib/openai/client.ts).
// Overridáveis por env var caso o modelo padrão saia do catálogo grátis.
const OPENROUTER_ROUTINE_MODEL =
  process.env.OPENROUTER_MODEL_ROUTINE ?? "meta-llama/llama-3.3-70b-instruct:free";
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
  // Nem todo modelo gratuito do OpenRouter suporta JSON mode — o
  // SYSTEM_PROMPT já exige JSON explicitamente, então response_format fica
  // só como reforço extra quando o provedor é a OpenAI de verdade.
  const responseFormat =
    getAiProvider() === "openai"
      ? ({ response_format: { type: "json_object" as const } } as const)
      : {};

  const completion = await client.chat.completions.create({
    model,
    ...responseFormat,
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
