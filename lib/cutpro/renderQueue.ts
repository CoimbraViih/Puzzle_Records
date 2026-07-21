import { createClient } from "@/lib/supabase/server";
import { isCutProBusy } from "@/lib/cutpro/labels";
import type { CutProEditableRow } from "@/lib/cutpro/pipeline";

/** Item da fila de renderização — uma linha de `drive_items` ou `posts` cujo
 * `edit_status` está em andamento (enviando/clipando/renderizando). Ver
 * docs/superpowers/specs/2026-07-21-quadro-renderizacao-design.md, Task 3. */
export interface RenderQueueItem {
  id: string;
  /** Nome pra exibir: filename do drive_item, ou headline/caption do post. */
  name: string;
  source: "drive" | "post";
  edit_status: CutProEditableRow["edit_status"];
  cutpro_render_progress: number | null;
  updated_at: string;
}

const BUSY_STATUSES = ["enviando", "clipando", "renderizando"] as const;

/** Busca, das duas tabelas (`drive_items` e `posts`), todas as linhas em
 * edição com template ativa. Duas queries simples combinadas em memória —
 * cada uma falha (e degrada pra lista vazia) independente da outra, mesmo
 * padrão de listDriveItems/listPosts: se `cutpro_render_progress` ainda não
 * existir em produção (migration 0030 não aplicada), a query daquela tabela
 * erra e essa fonte simplesmente não aparece na fila, em vez de derrubar a
 * página inteira. */
export async function listRenderQueue(): Promise<RenderQueueItem[]> {
  const supabase = await createClient();

  const [driveResult, postsResult] = await Promise.all([
    supabase
      .from("drive_items")
      .select("id, filename, edit_status, cutpro_render_progress, updated_at")
      .in("edit_status", BUSY_STATUSES)
      .order("updated_at", { ascending: false }),
    supabase
      .from("posts")
      .select("id, headline, caption, edit_status, cutpro_render_progress, updated_at")
      .in("edit_status", BUSY_STATUSES)
      .order("updated_at", { ascending: false }),
  ]);

  const driveItems: RenderQueueItem[] = [];
  if (driveResult.error) {
    console.error("[cutpro] falha ao listar drive_items em edição:", driveResult.error.message);
  } else {
    for (const row of driveResult.data ?? []) {
      if (!isCutProBusy(row.edit_status)) continue;
      driveItems.push({
        id: row.id,
        name: row.filename,
        source: "drive",
        edit_status: row.edit_status,
        cutpro_render_progress: row.cutpro_render_progress ?? null,
        updated_at: row.updated_at,
      });
    }
  }

  const postItems: RenderQueueItem[] = [];
  if (postsResult.error) {
    console.error("[cutpro] falha ao listar posts em edição:", postsResult.error.message);
  } else {
    for (const row of postsResult.data ?? []) {
      if (!isCutProBusy(row.edit_status)) continue;
      postItems.push({
        id: row.id,
        name: row.headline ?? row.caption ?? "Post sem título",
        source: "post",
        edit_status: row.edit_status,
        cutpro_render_progress: row.cutpro_render_progress ?? null,
        updated_at: row.updated_at,
      });
    }
  }

  return [...driveItems, ...postItems].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}
