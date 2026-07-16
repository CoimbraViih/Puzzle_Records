"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/**
 * Botão de submit com feedback de carregamento via useFormStatus — extrai o
 * padrão que já existia isolado nos botões da página Drive (useTransition +
 * disabled={isPending}) pra qualquer <form action={serverAction}> do painel.
 * Sem isso, um duplo clique em "Aprovar"/"Enviar para aprovação" dispara a
 * action duas vezes e o usuário não tem nenhum sinal visual de que algo está
 * acontecendo (achado da revisão de design de 16/07/2026).
 */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button {...props} type="submit" disabled={pending || props.disabled}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
