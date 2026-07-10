import { FilterableBoard } from "@/components/kanban/filterable-board";
import { PageHeader } from "@/components/dashboard/page-header";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listPosts, listSocialAccounts } from "@/lib/posts/queries";

export const dynamic = "force-dynamic";

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();
  const [posts, socialAccounts] = await Promise.all([
    listPosts(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 md:px-8">
      <PageHeader
        title="Fila de aprovação"
        description="Revise, edite ou rejeite os posts pendentes de aprovação."
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
