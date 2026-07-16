import Link from "next/link";
import { Share2, Plug, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

const ADMIN_LINKS = [
  { title: "Contas sociais", description: "Conectar e gerenciar contas do Zernio.", href: "/admin/contas", icon: Share2 },
  { title: "Integrações", description: "Google Drive e Cut.Pro.", href: "/admin/integracoes", icon: Plug },
  { title: "Usuários", description: "Papéis e acesso ao painel.", href: "/admin/usuarios", icon: Users },
];

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-10 md:px-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
          {profile ? ROLE_LABELS[profile.role] : "Admin"}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Bem-vindo, admin
        </h1>
      </div>

      <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
        {ADMIN_LINKS.map(({ title, description, href, icon: Icon }) => (
          <Button
            key={href}
            variant="outline"
            nativeButton={false}
            render={<Link href={href} />}
            className="h-auto flex-col items-start gap-1.5 whitespace-normal px-4 py-4 text-left"
          >
            <Icon className="size-5 text-primary" />
            <span className="text-sm font-medium text-foreground">{title}</span>
            <span className="text-xs font-normal text-muted-foreground">{description}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
