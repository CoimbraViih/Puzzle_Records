import { KanbanBoard } from "@/components/kanban/board";
import { PostFormDialog } from "@/components/kanban/post-form-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function ConteudoPage() {
  const profile = await getCurrentProfile();
  const [posts, artists, socialAccounts] = await Promise.all([
    listPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Fila de posts"
        description="Acompanhe o pipeline de conteúdo, do rascunho à aprovação."
        actions={
          <PostFormDialog
            mode="create"
            artists={artists}
            socialAccounts={socialAccounts}
            triggerLabel="Novo post"
          />
        }
      />

      {profile && (
        <KanbanBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          artists={artists}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
