import { createClient } from "@/lib/supabase/server";

export type QaTestRun = {
  id: string;
  step: string;
  target: string;
  result: "ok" | "fail" | "info";
  detail: string | null;
  created_at: string;
};

export async function listRecentTestRuns(limit = 100): Promise<QaTestRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qa_test_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Falha ao listar qa_test_runs:", error.message);
    return [];
  }
  return data;
}
