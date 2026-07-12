"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { mediaTypeFromFile, uploadMedia } from "@/lib/posts/media";
import { createClient } from "@/lib/supabase/server";

export type AcervoFormState = { error?: string; success?: boolean } | undefined;

function revalidateAcervoPages() {
  revalidatePath("/conteudo");
  revalidatePath("/aprovacao");
  revalidatePath("/acervo");
  revalidatePath("/admin");
}

export async function createAcervoPost(
  _prevState: AcervoFormState,
  formData: FormData
): Promise<AcervoFormState> {
  const profile = await getCurrentProfile();
  if (
    !profile ||
    (profile.role !== "equipe_conteudo" && profile.role !== "admin")
  ) {
    return { error: "Você não tem permissão para adicionar ao acervo." };
  }

  const socialAccountId = String(formData.get("social_account_id") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();

  if (!socialAccountId || !caption) {
    return { error: "Preencha a conta social e a legenda." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  const supabase = await createClient();

  const { data: socialAccount, error: socialAccountError } = await supabase
    .from("social_accounts")
    .select("network")
    .eq("id", socialAccountId)
    .maybeSingle();

  if (socialAccountError || !socialAccount) {
    return { error: "Conta social selecionada não foi encontrada." };
  }

  if (socialAccount.network !== "instagram") {
    return { error: "Conta social selecionada não é uma conta Instagram." };
  }

  let mediaPath: string;
  try {
    mediaPath = await uploadMedia(mediaFile);
  } catch {
    return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
  }

  const { error } = await supabase.from("posts").insert({
    social_account_id: socialAccountId,
    caption,
    media_url: mediaPath,
    media_type: mediaTypeFromFile(mediaFile),
    rendered_art_url: mediaPath,
    content_source: "acervo",
    post_type: "viral_geral",
    status: "rascunho",
    created_by: profile.id,
  });

  if (error) {
    return { error: "Não foi possível salvar o item do acervo." };
  }

  revalidateAcervoPages();
  return { success: true };
}
