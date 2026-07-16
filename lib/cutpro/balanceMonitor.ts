import type { SupabaseClient } from "@supabase/supabase-js";

import { getCutProProvider } from "./index";

const LOW_BALANCE_PLAN_CREDITS_REFERENCE = 1000; // plano Plus contratado (ver docs/plans/2026-07-15-m16-drive-cutpro.md D0).
const LOW_BALANCE_THRESHOLD_RATIO = 0.2;

/**
 * Chamado no início de cada ciclo do cron `cutpro-pipeline` (D6). Guard
 * idempotente via singleton `cutpro_status.low_balance_alerted` — mesmo
 * padrão de `connection_status`/`consecutive_publish_failures` em
 * `social_accounts` (publish-scheduled): só insere notificação na
 * *transição* para abaixo do limiar, reseta quando o saldo volta a subir.
 * Falha aqui nunca deve travar o resto do pipeline — só loga.
 */
export async function checkCutProBalance(supabase: SupabaseClient): Promise<void> {
  let balance: number;
  try {
    const result = await getCutProProvider().getBalance();
    balance = result.balance;
  } catch (err) {
    console.error("[cutpro-pipeline] falha ao consultar saldo Cut.Pro:", err);
    return;
  }

  const { data: status, error: statusError } = await supabase
    .from("cutpro_status")
    .select("low_balance_alerted")
    .eq("id", true)
    .maybeSingle();
  if (statusError) {
    console.error("[cutpro-pipeline] falha ao ler cutpro_status:", statusError);
    return;
  }

  const isLow = balance < LOW_BALANCE_PLAN_CREDITS_REFERENCE * LOW_BALANCE_THRESHOLD_RATIO;
  const alreadyAlerted = status?.low_balance_alerted ?? false;

  if (isLow && !alreadyAlerted) {
    const { error: notifyError } = await supabase.from("notifications").insert({
      type: "cutpro_saldo_baixo",
      message: `Saldo de créditos do Cut.Pro abaixo de 20% (${balance} créditos restantes).`,
    });
    if (notifyError) {
      console.error("[cutpro-pipeline] falha ao gravar notificação de saldo baixo:", notifyError);
      return;
    }
    await supabase.from("cutpro_status").update({ low_balance_alerted: true }).eq("id", true);
  } else if (!isLow && alreadyAlerted) {
    await supabase.from("cutpro_status").update({ low_balance_alerted: false }).eq("id", true);
  }
}
