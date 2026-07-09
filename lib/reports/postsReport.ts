import {
  POST_STATUS_LABELS,
  POST_TYPE_LABELS,
  type PostStatus,
  type PostType,
  type ContentSource,
} from "@/lib/types/post";

/** Shape mínimo consumido do join posts + post_metrics (ver Task 7). */
export interface PostReportInput {
  id: string;
  status: PostStatus;
  post_type: PostType;
  content_source: ContentSource;
  headline: string | null;
  caption: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  post_url: string | null;
  created_at: string;
  artist: { name: string } | null;
  social_account: { display_name: string } | null;
  metrics: {
    likes: number | null;
    comments: number | null;
    reach: number | null;
  } | null;
}

const HEADERS = [
  "id",
  "status",
  "tipo",
  "origem",
  "artista",
  "conta",
  "manchete",
  "legenda",
  "criado_em",
  "agendado_para",
  "publicado_em",
  "link",
  "curtidas",
  "comentarios",
  "alcance",
];

export function buildPostsReportRows(posts: PostReportInput[]): {
  headers: string[];
  rows: (string | number | null)[][];
} {
  return {
    headers: HEADERS,
    rows: posts.map((post) => [
      post.id,
      POST_STATUS_LABELS[post.status],
      POST_TYPE_LABELS[post.post_type],
      post.content_source,
      post.artist?.name ?? null,
      post.social_account?.display_name ?? null,
      post.headline,
      post.caption,
      post.created_at,
      post.scheduled_at,
      post.published_at,
      post.post_url,
      post.metrics?.likes ?? null,
      post.metrics?.comments ?? null,
      post.metrics?.reach ?? null,
    ]),
  };
}
