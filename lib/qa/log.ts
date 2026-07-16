import { createServiceClient } from "@/lib/supabase/service";

export type QaTestResult = "ok" | "fail" | "info";

/**
 * Usado só pelo script de QA (fora de uma sessão de usuário) -- nunca
 * importar em código que roda a partir de uma requisição de usuário.
 */
export async function logTestEvent(
  step: string,
  target: string,
  result: QaTestResult,
  detail?: string
) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("qa_test_runs").insert({
    step,
    target,
    result,
    detail: detail ?? null,
  });
  if (error) {
    console.error("Falha ao gravar log de QA:", error.message);
  }
}
