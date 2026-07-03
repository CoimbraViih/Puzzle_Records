"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createClient } from "@/lib/supabase/server";
import type {
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

function mediaTypeFromFile(file: File): MediaType {
  return file.type.startsWith("video/") ? "video" : "image";
}

async function uploadMedia(file: File): Promise<string> {
  const supabase = await createClient();
  const extension = file.name.split(".").pop() ?? "bin";
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("posts-media")
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error("upload_failed");
  }

  return path;
}

function readPostFields(formData: FormData) {
  return {
    artist_id: (formData.get("artist_id") as string) || null,
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
  await supabase.from("posts").delete().eq("id", postId);
  revalidatePostPages();
}

async function updateStatus(
  postId: string,
  status: PostStatus,
  extra: Record<string, unknown> = {}
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("posts")
    .update({ status, ...extra })
    .eq("id", postId);
  return error;
}

export async function submitForApproval(postId: string, _formData: FormData) {
  const error = await updateStatus(postId, "pendente_aprovacao");
  if (!error) revalidatePostPages();
}

export async function approvePost(postId: string, _formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const error = await updateStatus(postId, "aprovado", {
    approved_by: profile.id,
    rejection_reason: null,
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
    .update({ status: "rejeitado", approved_by: profile.id, rejection_reason: reason })
    .eq("id", postId)
    .select("id");

  if (error || !data || data.length === 0) {
    return { error: "Não foi possível rejeitar o post." };
  }

  revalidatePostPages();
  return { success: true };
}
