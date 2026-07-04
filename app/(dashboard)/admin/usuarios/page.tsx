"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

type UserRow = { id: string; email: string; role: Role; created_at: string };

export default function UsuariosPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("equipe_conteudo");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadUsers() {
    const res = await fetch("/api/admin/usuarios");
    if (res.ok) {
      const { users: data } = await res.json();
      setUsers(data);
    }
  }

  useEffect(() => {
    // Busca inicial da lista ao montar a página — não há Server Component
    // aqui (a lista é atualizada via fetch/refetch após convite), então o
    // carregamento no mount é intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, []);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    const res = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });

    setLoading(false);

    if (res.ok) {
      setStatus("Convite enviado.");
      setEmail("");
      loadUsers();
    } else {
      const { error } = await res.json();
      setStatus(`Erro: ${error}`);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Usuários</h1>

      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm text-muted-foreground">
            E-mail
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm text-muted-foreground">
            Papel
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={loading}>
          {loading ? "Convidando..." : "Convidar"}
        </Button>
      </form>

      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">E-mail</th>
            <th className="py-2">Papel</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-border/50">
              <td className="py-2 text-foreground">{user.email}</td>
              <td className="py-2 text-foreground">
                {ROLE_LABELS[user.role]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
