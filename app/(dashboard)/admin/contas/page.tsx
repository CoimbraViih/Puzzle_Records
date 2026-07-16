import { redirect } from "next/navigation";

export default function ContasRedirectPage() {
  redirect("/admin?tab=contas");
}
