"use client";

import { useState, useTransition } from "react";
import { Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { startCutProEdit } from "@/lib/drive/actions";
import { startCutProEditForPost } from "@/lib/posts/actions";

type EditWithTemplateButtonProps =
  | { kind: "drive"; driveItemId: string }
  | { kind: "post"; postId: string };

/** Mesmo botão/UX pros dois pontos de entrada do Cut.Pro (M16 Drive
 * curado, e M19-todos-fluxos Post rápido/acervo) — só troca qual server
 * action chamar conforme a prop recebida. */
export function EditWithTemplateButton(props: EditWithTemplateButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const runEdit =
    props.kind === "drive"
      ? () => startCutProEdit(props.driveItemId)
      : () => startCutProEditForPost(props.postId);

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await runEdit();
            setError(result.error ?? null);
          })
        }
      >
        <Clapperboard className={isPending ? "animate-pulse" : undefined} />
        Editar com template
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
