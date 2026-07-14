"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/**
 * Botão de submit que pede confirmação antes de disparar a action —
 * usado nas exclusões (post, conta social), que hoje disparavam a
 * server action imediatamente ao clicar, sem nenhuma fricção, ao
 * contrário do padrão de confirmação já usado em RejectDialog.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { confirmMessage: string }) {
  return (
    <Button
      {...props}
      type="submit"
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
