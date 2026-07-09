"use client";

import { useState } from "react";

import { KanbanBoard } from "@/components/kanban/board";
import { BoardFilters } from "@/components/kanban/board-filters";
import {
  EMPTY_POST_FILTERS,
  matchesPostFilters,
  type PostFilters,
} from "@/lib/posts/filterPosts";
import type { Artist } from "@/lib/types/artist";
import type { PostWithRelations } from "@/lib/types/post";
import type { Role } from "@/lib/types/profile";
import type { SocialAccount } from "@/lib/types/social-account";

export function FilterableBoard({
  posts,
  currentUserId,
  role,
  artists,
  socialAccounts,
}: {
  posts: PostWithRelations[];
  currentUserId: string;
  role: Role;
  artists: Artist[];
  socialAccounts: SocialAccount[];
}) {
  const [filters, setFilters] = useState<PostFilters>(EMPTY_POST_FILTERS);
  const filtered = posts.filter((post) => matchesPostFilters(post, filters));

  return (
    <div className="flex flex-col gap-4">
      <BoardFilters
        filters={filters}
        onChange={setFilters}
        artists={artists}
        socialAccounts={socialAccounts}
        resultCount={filtered.length}
        totalCount={posts.length}
      />
      <KanbanBoard
        posts={filtered}
        currentUserId={currentUserId}
        role={role}
        artists={artists}
        socialAccounts={socialAccounts}
      />
    </div>
  );
}
