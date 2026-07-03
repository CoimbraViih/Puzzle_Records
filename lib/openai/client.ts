import OpenAI from "openai";

/**
 * Cliente OpenAI isolado (mesmo princípio de camada isolada usado pro
 * Drive/Zernio) — trocar de provedor de IA no futuro fica restrito a este
 * arquivo e a `lib/openai/generateCopy.ts`.
 */
export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return new OpenAI({ apiKey });
}
