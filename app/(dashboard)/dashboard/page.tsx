import Link from "next/link";

import { AnalyticsSummarySection } from "@/components/dashboard/analytics-summary";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { countMetricsErrors, listAnalyticsSummary } from "@/lib/analytics/queries";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listPosts, listSocialAccounts } from "@/lib/posts/queries";
import { POST_STATUSES, POST_STATUS_LABELS } from "@/lib/types/post";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const [posts, socialAccounts, analyticsSummary, metricsErrorCount] =
    await Promise.all([
      listPosts(),
      listSocialAccounts(),
      listAnalyticsSummary(),
      countMetricsErrors(),
    ]);

  const disconnectedAccounts = socialAccounts.filter(
    (account) => account.connection_status === "desconectada"
  );

  const countsByStatus = Object.fromEntries(
    POST_STATUSES.map((status) => [
      status,
      posts.filter((post) => post.status === status).length,
    ])
  ) as Record<(typeof POST_STATUSES)[number], number>;

  const canSeeAprovacao = profile?.role === "admin" || profile?.role === "aprovador";

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Visão geral"
        description={`Bem-vindo${profile?.full_name ? `, ${profile.full_name}` : ""} — resumo do pipeline de conteúdo da Puzzle Records.`}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {POST_STATUSES.map((status) => (
          <div
            key={status}
            className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <span className="text-2xl font-semibold tracking-tight">
              {countsByStatus[status]}
            </span>
            <span className="text-xs text-muted-foreground">
              {POST_STATUS_LABELS[status]}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-card-foreground">
          <span className="text-2xl font-semibold tracking-tight">
            {socialAccounts.length}
          </span>
          <span className="text-xs text-muted-foreground">
            {socialAccounts.length === 1
              ? "Conta social cadastrada"
              : "Contas sociais cadastradas"}
          </span>
        </div>
      </div>

      {disconnectedAccounts.length > 0 && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {disconnectedAccounts.length === 1
            ? `A conta ${disconnectedAccounts[0].display_name} parece estar desconectada — verifique em /admin/contas.`
            : `${disconnectedAccounts.length} contas parecem estar desconectadas — verifique em /admin/contas.`}
        </div>
      )}

      <AnalyticsSummarySection
        summary={analyticsSummary}
        metricsErrorCount={metricsErrorCount}
        headerAction={
          <a
            href="/api/reports/posts?dias=30"
            download
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/40"
          >
            Exportar CSV (30 dias)
          </a>
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-card-foreground">
          Acesso rápido
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/conteudo" />}
          >
            Fila de posts
          </Button>
          {canSeeAprovacao && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/aprovacao" />}
            >
              Fila de aprovação
            </Button>
          )}
          {profile?.role === "admin" && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/admin" />}
            >
              Painel admin
            </Button>
          )}
        </div>
      </div>

      {profile && (
        <p className="text-xs text-muted-foreground">
          Logado como {ROLE_LABELS[profile.role]}.
        </p>
      )}
    </div>
  );
}
