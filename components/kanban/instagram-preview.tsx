"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
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
  const isPreviewVideo =
    post.content_source === "acervo" && post.media_type === "video";

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
 * Botão "Ver preview" + modal. O projeto não tem um primitivo shadcn/ui
 * `Dialog` (`components/ui/dialog.tsx` não existe — só `Sheet`, que é um
 * painel lateral com API diferente). Por isso este componente segue o
 * mesmo padrão manual (useState + overlay fixo, sem fechar ao clicar no
 * backdrop) já usado em `reject-dialog.tsx` e `post-form-dialog.tsx`, em
 * vez do exemplo ilustrativo do brief que assumia um `Dialog` shadcn/ui.
 */
export function InstagramPreviewDialog({ post }: { post: PostWithRelations }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        Ver preview
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Preview do post
            </h2>

            <InstagramPreview post={post} />

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
