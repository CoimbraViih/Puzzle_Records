import { logout } from "@/app/login/actions";
import { KanbanBoard } from "@/components/kanban/board";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();
  const [posts, artists, socialAccounts] = await Promise.all([
    listPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
            {profile ? ROLE_LABELS[profile.role] : "Aprovador"}
          </span>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">
            Fila de aprovação
          </h1>
        </div>
        <form action={logout}>
          <Button type="submit" variant="outline">
            Sair
          </Button>
        </form>
      </div>

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
