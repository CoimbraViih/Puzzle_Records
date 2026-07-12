import {
  POST_STATUSES,
  POST_STATUS_LABELS,
  type PostWithRelations,
} from "@/lib/types/post";
import type { Role } from "@/lib/types/profile";
import type { SocialAccount } from "@/lib/types/social-account";

import { PostCard } from "./post-card";

export function KanbanBoard({
  posts,
  currentUserId,
  role,
  socialAccounts,
}: {
  posts: PostWithRelations[];
  currentUserId: string;
  role: Role;
  socialAccounts: SocialAccount[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {POST_STATUSES.map((status) => (
        <div
          key={status}
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {POST_STATUS_LABELS[status]}
          </h2>
          <div className="flex flex-col gap-3">
            {posts
              .filter(
                (post) =>
                  !(
                    post.content_source === "acervo" &&
                    (post.status === "aprovado" || post.status === "publicado")
                  )
              )
              .filter((post) => post.status === status)
              .map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUserId={currentUserId}
                  role={role}
                  socialAccounts={socialAccounts}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
