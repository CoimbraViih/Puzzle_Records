import type {
  PostMetrics,
  PublishInput,
  PublishingProvider,
  PublishResult,
} from "./types";
import { PublishError } from "./types";

export class ZernioProvider implements PublishingProvider {
  async publish(input: PublishInput): Promise<PublishResult> {
    const apiKey = process.env.ZERNIO_API_KEY;
    const baseUrl = process.env.ZERNIO_API_BASE_URL;

    if (!apiKey || !baseUrl) {
      throw new PublishError(
        "ZERNIO_API_KEY ou ZERNIO_API_BASE_URL não configurados."
      );
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_id: input.zernioAccountId,
          media_url: input.mediaUrl,
          caption: input.caption,
        }),
      });
    } catch {
      throw new PublishError("Falha de rede ao chamar a API do Zernio.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PublishError(
        `Zernio retornou ${response.status}: ${body || "sem detalhes"}.`
      );
    }

    const data = (await response.json().catch(() => null)) as
      | { url?: string }
      | null;

    if (!data?.url) {
      throw new PublishError(
        "Resposta do Zernio sem o link do post publicado."
      );
    }

    return { postUrl: data.url };
  }

  async getMetrics(postUrl: string): Promise<PostMetrics> {
    const apiKey = process.env.ZERNIO_API_KEY;
    const baseUrl = process.env.ZERNIO_API_BASE_URL;

    if (!apiKey || !baseUrl) {
      throw new PublishError(
        "ZERNIO_API_KEY ou ZERNIO_API_BASE_URL não configurados."
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/posts/metrics?url=${encodeURIComponent(postUrl)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
    } catch {
      throw new PublishError("Falha de rede ao chamar a API do Zernio.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PublishError(
        `Zernio retornou ${response.status}: ${body || "sem detalhes"}.`
      );
    }

    const data = (await response.json().catch(() => null)) as {
      likes?: number;
      comments?: number;
      reach?: number;
    } | null;

    if (!data) {
      throw new PublishError("Resposta do Zernio sem dados de métricas.");
    }

    return {
      likes: data.likes ?? null,
      comments: data.comments ?? null,
      reach: data.reach ?? null,
    };
  }
}
