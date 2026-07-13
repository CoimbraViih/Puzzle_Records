import { createClient } from "@/lib/supabase/server";
import type { VideoTemplate } from "@/lib/types/template";

export async function listVideoTemplates(): Promise<VideoTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Falha ao listar templates:", error);
    return [];
  }

  return (data as VideoTemplate[]) ?? [];
}

export async function getDefaultVideoTemplate(): Promise<VideoTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();

  if (error) {
    console.error("Falha ao buscar template default:", error);
    return null;
  }

  return (data as VideoTemplate) ?? null;
}
