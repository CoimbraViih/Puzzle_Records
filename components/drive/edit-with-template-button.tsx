"use client";

import { useState, useTransition } from "react";
import { Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { startCutProEdit } from "@/lib/drive/actions";

export function EditWithTemplateButton({ driveItemId }: { driveItemId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await startCutProEdit(driveItemId);
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
