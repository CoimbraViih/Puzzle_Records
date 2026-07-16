import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import ContasPanel from "@/components/admin/contas-panel";
import IntegracoesPanel from "@/components/admin/integracoes-panel";
import { TestesPanel } from "@/components/admin/testes-panel";
import UsuariosPanel from "@/components/admin/usuarios-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { listRecentTestRuns } from "@/lib/qa/queries";

export const dynamic = "force-dynamic";

const TABS = [
  { value: "contas", label: "Contas sociais" },
  { value: "integracoes", label: "Integrações" },
  { value: "usuarios", label: "Usuários" },
  { value: "testes", label: "Testes" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: TabValue = TABS.some((t) => t.value === tab)
    ? (tab as TabValue)
    : "contas";
  const testRuns = await listRecentTestRuns();

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader title="Painel admin" description="Configurações do sistema." />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          {TABS.map(({ value, label }) => (
            <TabsTab key={value} value={value}>
              {label}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="contas">
          <ContasPanel />
        </TabsPanel>
        <TabsPanel value="integracoes">
          <IntegracoesPanel />
        </TabsPanel>
        <TabsPanel value="usuarios">
          <UsuariosPanel />
        </TabsPanel>
        <TabsPanel value="testes">
          <TestesPanel initialRuns={testRuns} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
