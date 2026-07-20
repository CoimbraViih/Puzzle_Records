import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateDailyPostSlots } from "@/lib/calendar/actions";
import { SOCIAL_NETWORK_LABELS, type SocialAccount } from "@/lib/types/social-account";

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
          <form
            key={account.id}
            action={updateDailyPostSlots.bind(null, account.id)}
            className="flex flex-wrap items-center gap-3"
          >
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
          </form>
        ))}
      </div>
    </div>
  );
}
