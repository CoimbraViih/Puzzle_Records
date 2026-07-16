import { redirect } from "next/navigation";

export default function IntegracoesRedirectPage() {
  redirect("/admin?tab=integracoes");
}
