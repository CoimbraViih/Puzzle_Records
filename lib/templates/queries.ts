import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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

// Sem chamador atual no código — mantida para uso futuro em contexto autenticado (ex.: view de detalhe de template).
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

/**
 * Mesma consulta de getDefaultVideoTemplate(), mas via service client (bypassa RLS).
 * Uso exclusivo em contextos sem sessão de usuário, como crons — a policy
 * templates_select_authenticated exige auth.uid() não nulo, o que nunca é
 * verdade numa invocação do Vercel Cron autenticada só por CRON_SECRET.
 */
export async function getDefaultVideoTemplateForCron(): Promise<VideoTemplate | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();

  if (error) {
    console.error("Falha ao buscar template default (cron):", error);
    return null;
  }

  return (data as VideoTemplate) ?? null;
}
