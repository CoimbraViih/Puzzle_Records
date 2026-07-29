"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/**
 * Botão de submit que pede confirmação antes de disparar a action —
 * usado nas exclusões (post, conta social), que hoje disparavam a
 * server action imediatamente ao clicar, sem nenhuma fricção, ao
 * contrário do padrão de confirmação já usado em RejectDialog.
 *
 * Também mostra feedback de carregamento via useFormStatus (mesmo padrão de
 * SubmitButton) — antes, um clique em "Excluir" não tinha nenhum sinal
 * visual enquanto a exclusão acontecia (achado da auditoria de 29/07/2026).
 */
export function ConfirmSubmitButton({
  confirmMessage,
  onClick,
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { confirmMessage: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {pending && <Loader2 className="animate-spin" />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
