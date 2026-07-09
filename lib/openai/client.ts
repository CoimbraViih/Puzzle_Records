import OpenAI from "openai";

export type AiProvider = "openai" | "openrouter";

/**
 * OpenRouter expõe uma API compatível com a da OpenAI (mesmo SDK, troca só
 * `baseURL`/`apiKey`) e tem modelos gratuitos (sufixo `:free`) — usado para
 * testar o pipeline de geração de copy sem gastar crédito da OpenAI. Sem
 * `AI_PROVIDER` explícito, cai em OpenRouter automaticamente quando só
 * `OPENROUTER_API_KEY` está configurada (nenhuma mudança de comportamento
 * pra quem já usa `OPENAI_API_KEY`).
 */
export function getAiProvider(): AiProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "openrouter" || explicit === "openai") return explicit;
  if (!process.env.OPENAI_API_KEY && process.env.OPENROUTER_API_KEY) {
    return "openrouter";
  }
  return "openai";
}

/**
 * Cliente de IA isolado (mesmo princípio de camada isolada usado pro
 * Drive/Zernio) — trocar de provedor fica restrito a este arquivo e a
 * `lib/openai/generateCopy.ts`.
 */
export function createOpenAIClient(): OpenAI {
  if (getAiProvider() === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENROUTER_API_KEY environment variable.");
    }
    return new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Agente IA Puzzle Records",
      },
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return new OpenAI({ apiKey });
}
