"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ArtistFormState = { error?: string } | undefined;

export async function createArtist(
  _prevState: ArtistFormState,
  formData: FormData
): Promise<ArtistFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const handle = String(formData.get("handle") ?? "").trim();

  if (!name || !handle) {
    return { error: "Informe nome e @handle." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("artists").insert({ name, handle });

  if (error) {
    return { error: "Não foi possível salvar o artista." };
  }

  revalidatePath("/admin/artistas");
  return undefined;
}

export async function deleteArtist(artistId: string, _formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("artists").delete().eq("id", artistId);
  if (error) {
    console.error("Falha ao excluir artista:", error);
  }
  revalidatePath("/admin/artistas");
}
