export const ROLES = ["admin", "aprovador", "equipe_conteudo"] as const;

export type Role = (typeof ROLES)[number];

export interface Profile {
  id: string;
  email: string;
  role: Role;
  full_name: string | null;
  created_at: string;
}

export const ROLE_HOME: Record<Role, string> = {
  admin: "/dashboard",
  aprovador: "/dashboard",
  equipe_conteudo: "/dashboard",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  aprovador: "Aprovador",
  equipe_conteudo: "Equipe de conteúdo",
};
