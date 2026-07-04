import type { LucideIcon } from "lucide-react";
import { CheckSquare, Disc3, LayoutGrid, Share2, Shield, Users } from "lucide-react";

import type { Role } from "@/lib/types/profile";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  roles: Role[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

// Dois grupos deliberadamente: "Operação" é o dia a dia das personas equipe
// de conteúdo/aprovador; "Administração" é configuração, só admin (ver
// personas em docs/CLAUDE.md). Separar visualmente os dois deixa claro que
// um não depende do outro pra operar o pipeline de posts.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operação",
    items: [
      {
        title: "Fila de posts",
        url: "/conteudo",
        icon: LayoutGrid,
        roles: ["admin", "aprovador", "equipe_conteudo"],
      },
      {
        title: "Fila de aprovação",
        url: "/aprovacao",
        icon: CheckSquare,
        roles: ["admin", "aprovador"],
      },
    ],
  },
  {
    label: "Administração",
    items: [
      {
        title: "Painel admin",
        url: "/admin",
        icon: Shield,
        roles: ["admin"],
      },
      {
        title: "Artistas",
        url: "/admin/artistas",
        icon: Disc3,
        roles: ["admin"],
      },
      {
        title: "Contas sociais",
        url: "/admin/contas",
        icon: Share2,
        roles: ["admin"],
      },
      {
        title: "Usuários",
        url: "/admin/usuarios",
        icon: Users,
        roles: ["admin"],
      },
    ],
  },
];

export function navGroupsForRole(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}
