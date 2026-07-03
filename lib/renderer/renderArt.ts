import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFonts, loadLogoDataUri } from "./client";
import { templateA, CARD_WIDTH, CARD_HEIGHT } from "./templates/templateA";
import { templateB } from "./templates/templateB";

export class ArtRenderError extends Error {}

interface RenderArtInput {
  postId: string;
  template: "A" | "B";
  headline: string;
  mediaUrl: string;
  mediaType: "image" | "video";
}

/**
 * Renderiza a arte final do post e sobe o PNG para o bucket posts-media.
 * Lança ArtRenderError em qualquer falha — quem chama decide como registrar.
 * Retorna o path (não a URL completa) do PNG gerado no Storage.
 */
export async function renderArt(input: RenderArtInput): Promise<string> {
  if (input.mediaType !== "image") {
    throw new ArtRenderError(
      "Renderização de arte só é suportada para mídia do tipo imagem por enquanto."
    );
  }

  const supabase = createServiceClient();

  const { data: signedUrlData, error: signError } = await supabase.storage
    .from("posts-media")
    .createSignedUrl(input.mediaUrl, 60);
  if (signError || !signedUrlData) {
    throw new ArtRenderError(
      `Não foi possível gerar URL assinada da mídia original: ${signError?.message ?? "desconhecido"}`
    );
  }

  const mediaResponse = await fetch(signedUrlData.signedUrl);
  if (!mediaResponse.ok) {
    throw new ArtRenderError(`Falha ao baixar a mídia original (status ${mediaResponse.status}).`);
  }
  const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
  const mediaContentType = mediaResponse.headers.get("content-type") ?? "image/jpeg";
  const mediaDataUri = `data:${mediaContentType};base64,${mediaBuffer.toString("base64")}`;

  const [fonts, logoDataUri] = await Promise.all([loadFonts(), loadLogoDataUri()]);

  const element =
    input.template === "A"
      ? templateA({ headline: input.headline, mediaDataUri, logoDataUri })
      : templateB({ headline: input.headline, mediaDataUri, logoDataUri });

  let svg: string;
  try {
    svg = await satori(element, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts });
  } catch (err) {
    throw new ArtRenderError(
      `Falha ao montar o SVG da arte: ${err instanceof Error ? err.message : "erro desconhecido"}`
    );
  }

  const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng();

  const artPath = `art-${input.postId}-${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from("posts-media")
    .upload(artPath, png, { contentType: "image/png", upsert: false });
  if (uploadError) {
    throw new ArtRenderError(`Falha ao subir a arte gerada para o Storage: ${uploadError.message}`);
  }

  return artPath;
}
