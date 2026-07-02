import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function DefinirSenhaPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <SetPasswordForm title="Definir senha" />
    </div>
  );
}
