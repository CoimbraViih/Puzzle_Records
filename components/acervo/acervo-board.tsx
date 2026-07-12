import type { PostWithRelations } from "@/lib/types/post";
import { SOCIAL_NETWORK_LABELS } from "@/lib/types/social-account";

import { classifyAcervoState, type AcervoState } from "@/lib/acervo/classify";

const COLUMNS: { state: AcervoState; label: string }[] = [
  { state: "novo", label: "Novo" },
  { state: "agendado", label: "Agendado" },
  { state: "publicado", label: "Publicado" },
];

export function AcervoBoard({ posts }: { posts: PostWithRelations[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {COLUMNS.map((column) => (
        <div
          key={column.state}
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {column.label}
          </h2>
          <div className="flex flex-col gap-3">
            {posts
              .filter((post) => classifyAcervoState(post) === column.state)
              .map((post) => (
                <div
                  key={post.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                >
                  {post.media_signed_url && post.media_type === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.media_signed_url}
                      alt={post.caption ?? ""}
                      className="h-32 w-full rounded-md object-cover"
                    />
                  )}
                  {post.media_signed_url && post.media_type === "video" && (
                    <video
                      src={post.media_signed_url}
                      controls
                      className="h-32 w-full rounded-md object-cover"
                    />
                  )}
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {post.caption}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {post.social_account
                      ? `${
                          SOCIAL_NETWORK_LABELS[
                            post.social_account
                              .network as keyof typeof SOCIAL_NETWORK_LABELS
                          ] ?? post.social_account.network
                        } — ${post.social_account.display_name}`
                      : "Conta social não vinculada"}
                  </p>
                  {column.state === "agendado" && post.scheduled_at && (
                    <p className="text-xs text-primary">
                      Agendado para{" "}
                      {new Date(post.scheduled_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                  {post.post_url && (
                    <a
                      href={post.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline"
                    >
                      Ver post publicado
                    </a>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
