import { PageHeader } from "@/components/dashboard/page-header";
import { TemplateCard } from "@/components/templates/template-card";
import { TemplateFormDialog } from "@/components/templates/template-form-dialog";
import { listVideoTemplates } from "@/lib/templates/queries";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await listVideoTemplates();

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Templates de vídeo"
        description="Galeria de templates aplicados automaticamente no render de vídeo. Customize cores, fonte da legenda e elementos on/off — sem editor de timeline."
        actions={<TemplateFormDialog mode="create" />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  );
}
