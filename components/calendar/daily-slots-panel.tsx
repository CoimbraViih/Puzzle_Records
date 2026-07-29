"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateDailyPostSlots } from "@/lib/calendar/actions";
import { SOCIAL_NETWORK_LABELS, type SocialAccount } from "@/lib/types/social-account";

const TIME_FORMAT = /^\d{2}:\d{2}$/;

/**
 * Antes, um horário mal formatado (ex: "9:00") era filtrado em silêncio pela
 * mesma regex no server action (lib/calendar/actions.ts) e simplesmente
 * sumia da lista salva — o usuário não tinha como saber que o horário não
 * entrou na fila automática (achado da auditoria de produto de 29/07/2026).
 * Validação client-side aqui bloqueia o submit e mostra o horário inválido
 * antes de chegar no servidor.
 */
function DailySlotsForm({ account }: { account: SocialAccount }) {
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const raw = String(new FormData(event.currentTarget).get("daily_post_slots") ?? "");
    const slots = raw
      .split(",")
      .map((slot) => slot.trim())
      .filter((slot) => slot.length > 0);
    const invalidSlots = slots.filter((slot) => !TIME_FORMAT.test(slot));

    if (invalidSlots.length > 0) {
      event.preventDefault();
      setError(
        `Horário inválido: ${invalidSlots.join(", ")} — use o formato HH:MM (ex: 09:00).`
      );
      return;
    }

    setError(null);
  }

  return (
    <form
      action={updateDailyPostSlots.bind(null, account.id)}
      onSubmit={handleSubmit}
      className="flex flex-col gap-1"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-40 shrink-0 text-xs text-muted-foreground">
          {SOCIAL_NETWORK_LABELS[account.network]} — {account.display_name}
        </span>
        <Input
          name="daily_post_slots"
          defaultValue={account.daily_post_slots.join(", ")}
          placeholder="09:00, 13:00, 19:00"
          className="w-56 text-xs"
        />
        <Button type="submit" variant="ghost" size="sm">
          Salvar
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

/**
 * Horários do dia pra distribuição automática de posts aprovados (cron
 * daily-schedule) — movido de Admin > Contas (M21) pra ficar junto de
 * onde o usuário já visualiza os posts agendados. Ver
 * docs/superpowers/specs/2026-07-20-horarios-estrategicos-design.md.
 */
export function DailySlotsPanel({ accounts }: { accounts: SocialAccount[] }) {
  if (accounts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Horários de publicação</h3>
        <p className="text-xs text-muted-foreground">
          Todo post aprovado sem horário definido entra automaticamente no próximo horário livre
          abaixo (conteúdo curado tem prioridade sobre acervo).
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {accounts.map((account) => (
          <DailySlotsForm key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}
