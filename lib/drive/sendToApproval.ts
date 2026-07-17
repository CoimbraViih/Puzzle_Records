"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { resolveSocialAccount } from "@/lib/drive/resolveSocialAccount";
import { createClient } from "@/lib/supabase/server";

/**
 * Cria o post (pendente_aprovacao) a partir de um drive_item já com legenda
 * pronta — usa edited_media_path (Cut.Pro, Task 6) se existir, senão a
 * mídia original. Reaproveita 100% o pipeline existente a partir daqui
 * (fila → agendamento → Zernio → métricas), mesmo padrão de rendered_art_url
 * usado por createAcervoPost (M8) para vídeo/mídia sem geração de arte.
 * post_id em drive_items é a trava contra duplo envio.
 */
export async function sendDriveItemToApproval(
  driveItemId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: item, error: fetchError } = await supabase
    .from("drive_items")
    .select("id, media_type, media_storage_path, edited_media_path, caption, post_type, post_id")
    .eq("id", driveItemId)
    .maybeSingle();

  if (fetchError || !item) {
    return { error: "Item do Drive não encontrado." };
  }
  if (item.post_id) {
    return { error: "Este item já foi enviado para aprovação." };
  }
  if (!item.caption) {
    return { error: "Gere ou escreva uma legenda antes de enviar." };
  }
  const mediaPath = item.edited_media_path ?? item.media_storage_path;
  if (!mediaPath) {
    return { error: "Mídia ainda não disponível para este item." };
  }

  const resolution = await resolveSocialAccount(supabase);
  if (!resolution.socialAccountId) {
    return { error: "Nenhuma conta social cadastrada — configure em /admin (aba Contas sociais)." };
  }

  // Ação disparada por clique manual (não pelo cron automático) — grava o
  // autor quando há sessão, mesmo padrão de createAcervoPost/createPost.
  const profile = await getCurrentProfile();

  const { data: post, error: insertError } = await supabase
    .from("posts")
    .insert({
      social_account_id: resolution.socialAccountId,
      post_type: item.post_type,
      caption: item.caption,
      media_url: mediaPath,
      media_type: item.media_type,
      rendered_art_url: mediaPath,
      status: "pendente_aprovacao",
      content_source: "painel",
      created_by: profile?.id ?? null,
    })
    .select("id")
    .single();

  if (insertError || !post) {
    console.error("[drive] falha ao criar post a partir do drive_item:", driveItemId, insertError);
    return { error: "Não foi possível criar o post. Tente novamente." };
  }

  // Trava contra duplo envio: só grava post_id se ainda estiver nulo —
  // mesmo idioma de claim atômico usado no resto do projeto (evita 2
  // cliques rápidos criando 2 posts caso o primeiro update perca a corrida
  // com um segundo clique — se afetar 0 linhas, o post recém-criado acima
  // fica órfão em posts, aceitável: aparece na fila normalmente, só não
  // fica referenciado por este drive_item).
  const { data: claimed } = await supabase
    .from("drive_items")
    .update({ post_id: post.id })
    .eq("id", driveItemId)
    .is("post_id", null)
    .select("id");

  if (!claimed || claimed.length === 0) {
    console.error(
      "[drive] corrida detectada ao gravar post_id — post criado mas não vinculado:",
      driveItemId,
      post.id
    );
  }

  revalidatePath("/drive");
  revalidatePath("/aprovacao");
  return {};
}
