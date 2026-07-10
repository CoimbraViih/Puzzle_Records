"use client";

import { useState } from "react";

import { AcervoBoard } from "@/components/acervo/acervo-board";
import { BoardFilters } from "@/components/kanban/board-filters";
import {
  EMPTY_POST_FILTERS,
  matchesPostFilters,
  type PostFilters,
} from "@/lib/posts/filterPosts";
import type { PostWithRelations } from "@/lib/types/post";
import type { SocialAccount } from "@/lib/types/social-account";

export function FilterableAcervoBoard({
  posts,
  socialAccounts,
}: {
  posts: PostWithRelations[];
  socialAccounts: SocialAccount[];
}) {
  const [filters, setFilters] = useState<PostFilters>(EMPTY_POST_FILTERS);
  const filtered = posts.filter((post) => matchesPostFilters(post, filters));

  return (
    <div className="flex flex-col gap-4">
      <BoardFilters
        filters={filters}
        onChange={setFilters}
        socialAccounts={socialAccounts}
        showContentSource={false}
        showPostType={false}
        resultCount={filtered.length}
        totalCount={posts.length}
      />
      <AcervoBoard posts={filtered} />
    </div>
  );
}
