import { FilterableBoard } from "@/components/kanban/filterable-board";
import { PostFormDialog } from "@/components/kanban/post-form-dialog";
import { QuickPostDialog } from "@/components/kanban/quick-post-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";
// Post rápido com vídeo (createPostWithAI) roda síncrono: extração de frames
// via FFmpeg + transcrição Whisper + visão GPT-4o pode levar 20-60s — bem
// acima do default de 10-15s da Vercel. A duração de uma Server Action é
// regida pelo maxDuration da rota que a invoca (não tem export próprio).
export const maxDuration = 300;

export default async function ConteudoPage() {
  const profile = await getCurrentProfile();
  const [posts, socialAccounts] = await Promise.all([
    listPosts(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Fila de posts"
        description="Acompanhe o pipeline de conteúdo, do rascunho à aprovação."
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
