import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CheckSquare,
  FolderOpen,
  LayoutDashboard,
  Shield,
} from "lucide-react";

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
        title: "Visão geral",
        url: "/dashboard",
        icon: LayoutDashboard,
        roles: ["admin", "aprovador", "equipe_conteudo"],
      },
      {
        title: "Drive",
        url: "/drive",
        icon: FolderOpen,
        roles: ["admin", "aprovador", "equipe_conteudo"],
      },
      {
        title: "Calendário",
        url: "/calendario",
        icon: CalendarDays,
        roles: ["admin", "aprovador", "equipe_conteudo"],
      },
      {
        title: "Fila de aprovação",
        url: "/aprovacao",
        icon: CheckSquare,
        roles: ["admin", "aprovador", "equipe_conteudo"],
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
    ],
  },
];

export function navGroupsForRole(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}
