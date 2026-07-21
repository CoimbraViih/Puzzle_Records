import { FilterableBoard } from "@/components/kanban/filterable-board";
import { PostFormDialog } from "@/components/kanban/post-form-dialog";
import { QuickPostDialog } from "@/components/kanban/quick-post-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { RenderQueuePanel } from "@/components/cutpro/render-queue-panel";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listRenderQueue } from "@/lib/cutpro/renderQueue";
import { listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";
// Post rápido com vídeo (createPostWithAI) roda síncrono: extração de frames
// via FFmpeg + transcrição Whisper + visão GPT-4o pode levar 20-60s — bem
// acima do default de 10-15s da Vercel. A duração de uma Server Action é
// regida pelo maxDuration da rota que a invoca (não tem export próprio).
export const maxDuration = 300;

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();
  const [posts, socialAccounts, renderQueue] = await Promise.all([
    listPosts(),
    listSocialAccounts(),
    listRenderQueue(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Fila de aprovação"
        description="Revise, edite ou rejeite os posts pendentes de aprovação."
        actions={
          <div className="flex gap-2">
            <QuickPostDialog socialAccounts={socialAccounts} />
            <PostFormDialog
              mode="create"
              socialAccounts={socialAccounts}
              triggerLabel="Novo post"
            />
          </div>
        }
      />

      <RenderQueuePanel items={renderQueue} />

      {profile && (
        <FilterableBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
