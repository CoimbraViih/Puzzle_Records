"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { VideoTemplateConfig } from "@/lib/types/template";

function parseConfigFromForm(formData: FormData): VideoTemplateConfig {
  return {
    titleBox: {
      color: String(formData.get("titleBoxColor") ?? "#96DB12"),
      textColor: String(formData.get("titleBoxTextColor") ?? "#000000"),
      position: formData.get("titleBoxPosition") === "top-third" ? "top-third" : "bottom-third",
      durationSeconds: Number(formData.get("titleBoxDuration") ?? 3),
    },
    captionStyle:
      formData.get("captionStyle") === "classico" || formData.get("captionStyle") === "karaoke"
        ? (formData.get("captionStyle") as "classico" | "karaoke")
        : "viral",
    logo: {
      enabled: formData.get("logoEnabled") === "on",
      position: formData.get("logoPosition") === "top-left" ? "top-left" : "top-right",
    },
    progressBar: {
      enabled: formData.get("progressBarEnabled") === "on",
      color: String(formData.get("progressBarColor") ?? "#96DB12"),
    },
    footer: {
      enabled: formData.get("footerEnabled") === "on",
      text: String(formData.get("footerText") ?? "SIGA @puzzlerecordss"),
    },
  };
}

export async function createTemplate(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Nome do template é obrigatório." };
  }

  const { error } = await supabase.from("templates").insert({
    name,
    config: parseConfigFromForm(formData),
    format: "9:16",
    is_default: false,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/templates");
  return { error: null };
}

export async function updateTemplate(id: string, formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Nome do template é obrigatório." };
  }

  const { error } = await supabase
    .from("templates")
    .update({ name, config: parseConfigFromForm(formData) })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/templates");
  return { error: null };
}

export async function duplicateTemplate(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: original, error: fetchError } = await supabase
    .from("templates")
    .select("name, config, format")
    .eq("id", id)
    .single();

  if (fetchError || !original) {
    return { error: fetchError?.message ?? "Template original não encontrado." };
  }

  const { error } = await supabase.from("templates").insert({
    name: `${original.name} (cópia)`,
    config: original.config,
    format: original.format,
    is_default: false,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/templates");
  return { error: null };
}
