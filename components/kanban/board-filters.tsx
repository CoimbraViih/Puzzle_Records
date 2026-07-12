"use client";

import { Input } from "@/components/ui/input";
import type { SocialAccount } from "@/lib/types/social-account";
import {
  CONTENT_SOURCES,
  POST_TYPES,
  POST_TYPE_LABELS,
  type ContentSource,
  type PostType,
} from "@/lib/types/post";
import {
  EMPTY_POST_FILTERS,
  hasActiveFilters,
  type PostFilters,
} from "@/lib/posts/filterPosts";

const CONTENT_SOURCE_LABELS: Record<ContentSource, string> = {
  drive: "Drive",
  acervo: "Acervo",
  painel: "Painel",
};

const SELECT_CLASSES =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground";

export function BoardFilters({
  filters,
  onChange,
  socialAccounts,
  showContentSource = true,
  showPostType = true,
  resultCount,
  totalCount,
}: {
  filters: PostFilters;
  onChange: (filters: PostFilters) => void;
  socialAccounts: SocialAccount[];
  showContentSource?: boolean;
  showPostType?: boolean;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        placeholder="Buscar por manchete, legenda, música..."
        className="h-9 w-full sm:max-w-xs"
        aria-label="Buscar posts"
      />
      <select
        className={SELECT_CLASSES}
        value={filters.socialAccountId ?? ""}
        onChange={(e) =>
          onChange({ ...filters, socialAccountId: e.target.value || null })
        }
        aria-label="Filtrar por conta social"
      >
        <option value="">Todas as contas</option>
        {socialAccounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.display_name}
          </option>
        ))}
      </select>
      {showPostType && (
        <select
          className={SELECT_CLASSES}
          value={filters.postType ?? ""}
          onChange={(e) =>
            onChange({
              ...filters,
              postType: (e.target.value || null) as PostType | null,
            })
          }
          aria-label="Filtrar por tipo de post"
        >
          <option value="">Todos os tipos</option>
          {POST_TYPES.map((type) => (
            <option key={type} value={type}>
              {POST_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      )}
      {showContentSource && (
        <select
          className={SELECT_CLASSES}
          value={filters.contentSource ?? ""}
          onChange={(e) =>
            onChange({
              ...filters,
              contentSource: (e.target.value || null) as ContentSource | null,
            })
          }
          aria-label="Filtrar por origem"
        >
          <option value="">Todas as origens</option>
          {CONTENT_SOURCES.map((source) => (
            <option key={source} value={source}>
              {CONTENT_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      )}
      {hasActiveFilters(filters) && (
        <>
          <button
            type="button"
            onClick={() => onChange(EMPTY_POST_FILTERS)}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            Limpar filtros
          </button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {resultCount} de {totalCount} posts
          </span>
        </>
      )}
    </div>
  );
}
