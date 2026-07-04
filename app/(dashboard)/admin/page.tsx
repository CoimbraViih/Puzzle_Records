import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
        {profile ? ROLE_LABELS[profile.role] : "Admin"}
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Bem-vindo, admin
      </h1>
    </div>
  );
}
