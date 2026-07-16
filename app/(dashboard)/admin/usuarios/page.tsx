import { redirect } from "next/navigation";

export default function UsuariosRedirectPage() {
  redirect("/admin?tab=usuarios");
}
