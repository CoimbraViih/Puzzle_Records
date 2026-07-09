import { PageHeader } from "@/components/dashboard/page-header";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { listPosts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

function parseMonthParam(mes: string | undefined): { year: number; month: number } {
  const match = mes?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  // Default: mês corrente em São Paulo.
  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date()); // "YYYY-MM"
  const [year, month] = now.split("-").map(Number);
  return { year, month };
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const { year, month } = parseMonthParam(mes);

  const posts = await listPosts();
  // Só posts com horário definido interessam no calendário: agendados
  // (aprovado + scheduled_at) e publicados.
  const scheduled = posts.filter(
    (post) =>
      (post.status === "aprovado" && post.scheduled_at !== null) ||
      post.status === "publicado"
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Calendário"
        description="Posts agendados e publicados por dia (horário de São Paulo)."
      />
      <MonthCalendar year={year} month={month} posts={scheduled} />
    </div>
  );
}
