"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { PostWithRelations } from "@/lib/types/post";

const IG_PLACEHOLDER_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%2396DB12'/%3E%3C/svg%3E";

/**
 * Preview fiel de como o post vai aparecer publicado. Reaproveita a arte
 * final renderizada no M5 (`rendered_art_signed_url`) — é o que de fato vai
 * ao ar — e cai para a mídia bruta (`media_signed_url`) apenas quando a arte
 * ainda não foi gerada.
 *
 * M6 cobre só o preview do Instagram (ver `docs/CLAUDE.md` — Instagram
 * primeiro, depois TikTok/YouTube/Facebook). Para as demais redes mostramos
 * um fallback explícito de "ainda não implementado", nunca uma simulação
 * enganosa de UI que não existe de fato.
 */
export function InstagramPreview({ post }: { post: PostWithRelations }) {
  const isInstagram = post.social_account?.network === "instagram";
  const previewUrl = post.rendered_art_signed_url ?? post.media_signed_url ?? null;
  // Antes só considerava vídeo quando content_source === "acervo" (única
  // origem de post-vídeo quando este código foi escrito no M8) — o M17
  // migrou "Post rápido" (vídeo com IA, content_source "painel") pro mesmo
  // board sem atualizar esta checagem, então esses posts renderizavam
  // <img> apontando pra um .mp4 (ícone de imagem quebrada no preview).
  // media_type sozinho já é a fonte de verdade em todo o resto do
  // código (post-card.tsx, drive-item-card.tsx).
  const isPreviewVideo = post.media_type === "video";

  if (!isInstagram) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        Preview fiel para {post.social_account?.network ?? "essa rede"} ainda
        não implementado (M6 cobre só Instagram — ver `docs/CLAUDE.md`).
        Abaixo, a arte e a legenda como serão publicadas:
        {previewUrl && isPreviewVideo && (
          <video src={previewUrl} controls className="mt-2 w-full rounded" />
        )}
        {previewUrl && !isPreviewVideo && (
          // URL assinada temporária do Storage — não faz sentido no
          // otimizador de imagem do Next (expira e muda a cada carregamento).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={post.headline ?? ""}
            className="mt-2 w-full rounded"
          />
        )}
        <p className="mt-2 whitespace-pre-wrap">{post.caption}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={IG_PLACEHOLDER_AVATAR}
          alt=""
          className="h-8 w-8 rounded-full"
        />
        <span className="text-sm font-semibold">
          {post.social_account?.handle ?? "puzzlerecordss"}
        </span>
      </div>

      {previewUrl && isPreviewVideo && (
        <video
          src={previewUrl}
          controls
          className="aspect-square w-full object-cover"
        />
      )}
      {previewUrl && !isPreviewVideo && (
        // URL assinada temporária do Storage — não faz sentido no
        // otimizador de imagem do Next (expira e muda a cada carregamento).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={post.headline ?? ""}
          className="aspect-square w-full object-cover"
        />
      )}

      <div className="flex gap-3 p-3 text-lg">
        <span>♡</span>
        <span>💬</span>
        <span>↗</span>
      </div>

      <p className="px-3 pb-3 text-sm">
        <span className="font-semibold">
          {post.social_account?.handle ?? "puzzlerecordss"}
        </span>{" "}
        {post.caption}
      </p>
    </div>
  );
}

/**
 * Botão "Ver preview" + modal, usando o primitivo `Dialog` (`@base-ui/react`,
 * mesma base já usada pelo `Sheet`) — dá escape-to-close, focus trap e
 * `aria-modal` de graça, sem precisar de estado manual de abertura.
 */
export function InstagramPreviewDialog({ post }: { post: PostWithRelations }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        Ver preview
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogTitle>Preview do post</DialogTitle>

        <InstagramPreview post={post} />
      </DialogContent>
    </Dialog>
  );
}
