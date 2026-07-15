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

/**
 * Modelos gratuitos do OpenRouter (sem `response_format` estrito, ver
 * `generateCopyVariations`) costumam embrulhar o JSON em cerca de código
 * markdown (```json ... ```) ou acrescentar texto solto antes/depois —
 * a OpenAI real com `json_object` não faz isso. Extrai o primeiro objeto
 * `{...}` do texto antes de desistir, em vez de falhar no primeiro
 * `JSON.parse` cru.
 */
function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate;
  return candidate.slice(start, end + 1);
}

function parseVariations(raw: string): CopyVariation[] {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(raw));
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

  // Modelos gratuitos do OpenRouter (sem `response_format` estrito) falham
  // em devolver JSON válido com uma frequência bem maior que a OpenAI real —
  // uma segunda tentativa custa pouco e recupera a maioria desses casos.
  const attempts = getAiProvider() === "openrouter" ? 2 : 1;
  let lastError: CopyGenerationError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
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
      lastError = new CopyGenerationError("OpenAI retornou resposta vazia.");
      continue;
    }

    try {
      return parseVariations(content);
    } catch (error) {
      if (!(error instanceof CopyGenerationError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new CopyGenerationError("Falha desconhecida ao gerar copy.");
}
