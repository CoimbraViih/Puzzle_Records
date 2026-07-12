"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { generateCopyVariations, CopyGenerationError } from "@/lib/openai/generateCopy";
import { renderArt, ArtRenderError } from "@/lib/renderer/renderArt";
import { createClient } from "@/lib/supabase/server";
import { mediaTypeFromFile, uploadMedia } from "@/lib/posts/media";
import type {
  CopyVariation,
  MediaType,
  PostStatus,
  PostTemplate,
  PostType,
} from "@/lib/types/post";

export type PostFormState = { error?: string; success?: boolean } | undefined;

function revalidatePostPages() {
  revalidatePath("/conteudo");
  revalidatePath("/aprovacao");
  revalidatePath("/admin");
}

function readPostFields(formData: FormData) {
  return {
    social_account_id: String(formData.get("social_account_id") ?? ""),
    template: String(formData.get("template") ?? "") as PostTemplate,
    post_type: String(formData.get("post_type") ?? "") as PostType,
    headline: String(formData.get("headline") ?? "").trim(),
    caption: String(formData.get("caption") ?? "").trim(),
    scheduled_at: (formData.get("scheduled_at") as string) || null,
  };
}

function validatePostFields(fields: ReturnType<typeof readPostFields>) {
  return Boolean(
    fields.social_account_id &&
      fields.template &&
      fields.post_type &&
      fields.headline &&
      fields.caption
  );
}

export async function createPost(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (
    !profile ||
    (profile.role !== "equipe_conteudo" && profile.role !== "admin")
  ) {
    return { error: "Você não tem permissão para criar posts." };
  }

  const fields = readPostFields(formData);
  if (!validatePostFields(fields)) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  let mediaPath: string;
  try {
    mediaPath = await uploadMedia(mediaFile);
  } catch {
    return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    ...fields,
    media_url: mediaPath,
    media_type: mediaTypeFromFile(mediaFile),
    status: "rascunho",
    created_by: profile.id,
  });

  if (error) {
    return { error: "Não foi possível salvar o post." };
  }

  revalidatePostPages();
  return { success: true };
}

/**
 * Best-effort: remove um arquivo já enviado ao Storage quando o resto do
 * pipeline (IA ou insert) falha depois do upload, pra não acumular objeto
 * órfão a cada tentativa. Nunca deve mascarar o erro original — só loga.
 */
async function cleanupOrphanedMedia(mediaPath: string) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.storage.from("posts-media").remove([mediaPath]);
    if (error) {
      console.error("Falha ao limpar mídia órfã no Storage:", mediaPath, error);
    }
  } catch (err) {
    console.error("Falha ao limpar mídia órfã no Storage:", mediaPath, err);
  }
}

/**
 * Caminho "imediato" do painel: upload direto de mídia (sem passar pelo
 * Drive) com legenda gerada pela IA de forma síncrona, dentro da própria
 * action. Não confundir com `createPost` (formulário manual do M2, sem IA).
 */
export async function createPostWithAI(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (
    !profile ||
    (profile.role !== "equipe_conteudo" && profile.role !== "admin")
  ) {
    return { error: "Você não tem permissão para criar posts." };
  }

  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const postType = String(formData.get("post_type") ?? "") as PostType;
  const templateRaw = String(formData.get("template") ?? "");
  const context = String(formData.get("context") ?? "").trim();

  if (!socialAccountId || !postType) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  const mediaType = mediaTypeFromFile(mediaFile);

  if (mediaType === "image" && !context) {
    return { error: "Digite o contexto da imagem para a IA escrever a legenda." };
  }
  // Template só se aplica à renderização de news card (M5), que só existe
  // pra imagem — vídeo nunca usa esse campo, ver docs/CLAUDE.md.
  if (mediaType === "image" && !templateRaw) {
    return { error: "Selecione um template para a imagem." };
  }
  const template: PostTemplate | null =
    mediaType === "image" ? (templateRaw as PostTemplate) : null;

  let mediaPath: string;
  let mediaBuffer: Buffer;
  try {
    mediaBuffer = Buffer.from(await mediaFile.arrayBuffer());
    mediaPath = await uploadMedia(mediaFile);
  } catch {
    return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
  }

  let variations: CopyVariation[];
  try {
    variations =
      mediaType === "video"
        ? await generateCopyVariations({
            mode: "video",
            postType,
            trackName: null,
            additionalContext: context || null,
            videoBuffer: mediaBuffer,
            filename: mediaFile.name,
          })
        : await generateCopyVariations({
            mode: "text",
            postType,
            fact: context,
            trackName: null,
          });
  } catch (err) {
    const message =
      err instanceof CopyGenerationError
        ? err.message
        : "A IA não conseguiu gerar a legenda. Tente novamente.";
    console.error("Falha ao gerar copy no upload direto:", err);
    await cleanupOrphanedMedia(mediaPath);
    return { error: message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    social_account_id: socialAccountId,
    template,
    post_type: postType,
    headline: variations[0].headline,
    caption: variations[0].caption,
    copy_variations: variations,
    media_url: mediaPath,
    media_type: mediaType,
    // Vídeo nunca gera news card (M5 é só imagem) — mesmo padrão do
    // acervo (M8): a própria mídia é a "arte". Sem isso, o post fica
    // travado pra sempre no gate de publicação do M7 (exige
    // rendered_art_url preenchido).
    rendered_art_url: mediaType === "video" ? mediaPath : null,
    source_fact: context || null,
    status: "rascunho",
    content_source: "painel",
    created_by: profile.id,
  });

  if (error) {
    console.error("Falha ao salvar post do upload direto:", error);
    await cleanupOrphanedMedia(mediaPath);
    return { error: "Não foi possível salvar o post." };
  }

  revalidatePostPages();
  return { success: true };
}

export async function updatePost(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const postId = String(formData.get("post_id") ?? "");
  if (!postId) {
    return { error: "Post inválido." };
  }

  const fields = readPostFields(formData);
  if (!validatePostFields(fields)) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const update: Record<string, unknown> = { ...fields };

  const mediaFile = formData.get("media") as File | null;
  if (mediaFile && mediaFile.size > 0) {
    try {
      update.media_url = await uploadMedia(mediaFile);
      update.media_type = mediaTypeFromFile(mediaFile);
    } catch {
      return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update(update)
    .eq("id", postId)
    .select("id");

  if (error || !data || data.length === 0) {
    return {
      error:
        "Não foi possível salvar as alterações. Verifique se você ainda pode editar este post.",
    };
  }

  revalidatePostPages();
  return { success: true };
}

export async function deletePost(postId: string, _formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error(
      "Falha ao excluir post (bloqueado por RLS ou erro do Supabase):",
      postId,
      error
    );
    return;
  }

  revalidatePostPages();
}

async function updateStatus(
  postId: string,
  status: PostStatus,
  extra: Record<string, unknown> = {}
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update({ status, ...extra })
    .eq("id", postId)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error(
      `Falha ao mudar post para status "${status}" (bloqueado por RLS ou erro do Supabase):`,
      postId,
      error
    );
    return error ?? new Error("rls_blocked");
  }

  return null;
}

export async function submitForApproval(postId: string, _formData: FormData) {
  const error = await updateStatus(postId, "pendente_aprovacao", {
    submitted_for_approval_at: new Date().toISOString(),
    sla_alert_sent_at: null,
    notification_error: null,
  });
  if (error) return;

  revalidatePostPages();
}

export async function approvePost(postId: string, _formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const error = await updateStatus(postId, "aprovado", {
    approved_by: profile.id,
    rejection_reason: null,
    submitted_for_approval_at: null,
    sla_alert_sent_at: null,
    notification_error: null,
  });
  if (!error) revalidatePostPages();
}

export async function rejectPost(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const postId = String(formData.get("post_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!postId || !reason) {
    return { error: "Informe o motivo da rejeição." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update({
      status: "rejeitado",
      approved_by: profile.id,
      rejection_reason: reason,
      submitted_for_approval_at: null,
      sla_alert_sent_at: null,
      notification_error: null,
    })
    .eq("id", postId)
    .select("id");

  if (error || !data || data.length === 0) {
    return { error: "Não foi possível rejeitar o post." };
  }

  revalidatePostPages();
  return { success: true };
}

export async function selectCopyVariation(
  postId: string,
  index: number,
  _formData: FormData
) {
  const supabase = await createClient();
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("copy_variations")
    .eq("id", postId)
    .single();

  const variations = post?.copy_variations as CopyVariation[] | null;
  const variation = variations?.[index];
  if (fetchError || !variation) {
    console.error(
      "Falha ao trocar variação de copy (post ou índice inválido):",
      postId,
      index,
      fetchError
    );
    return;
  }

  const { data: updated, error } = await supabase
    .from("posts")
    .update({ headline: variation.headline, caption: variation.caption })
    .eq("id", postId)
    .select("id");

  if (error || !updated || updated.length === 0) {
    console.error(
      "Falha ao aplicar variação selecionada (bloqueado por RLS ou erro do Supabase):",
      postId,
      error
    );
    return;
  }

  revalidatePostPages();
}

export async function regenerateArt(postId: string) {
  const supabase = await createClient();
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("id, template, headline, media_url, media_type")
    .eq("id", postId)
    .single();

  if (fetchError || !post || !post.template || !post.headline) {
    console.error(
      "Falha ao regenerar arte (post inválido ou sem template/headline prontos):",
      postId,
      fetchError
    );
    return;
  }

  try {
    const artPath = await renderArt({
      postId: post.id,
      template: post.template as PostTemplate,
      headline: post.headline,
      mediaUrl: post.media_url,
      mediaType: post.media_type as MediaType,
    });

    const { data: updated, error } = await supabase
      .from("posts")
      .update({ rendered_art_url: artPath, art_generation_error: null })
      .eq("id", postId)
      .select("id");

    if (error || !updated || updated.length === 0) {
      console.error(
        "Falha ao gravar arte regenerada (bloqueado por RLS ou erro do Supabase):",
        postId,
        error
      );
      return;
    }
  } catch (err) {
    const message =
      err instanceof ArtRenderError ? err.message : "Erro inesperado ao gerar a arte.";

    const { data: updated, error } = await supabase
      .from("posts")
      .update({ art_generation_error: message })
      .eq("id", postId)
      .select("id");

    if (error || !updated || updated.length === 0) {
      console.error(
        "Falha ao gravar art_generation_error (bloqueado por RLS ou erro do Supabase):",
        postId,
        error
      );
    }
    revalidatePostPages();
    return;
  }

  revalidatePostPages();
}

export async function retryPublish(postId: string, _formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update({ publish_error: null })
    .eq("id", postId)
    .is("post_url", null)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error(
      "Falha ao limpar publish_error (bloqueado por RLS ou erro do Supabase):",
      postId,
      error
    );
    return;
  }

  revalidatePostPages();
}
