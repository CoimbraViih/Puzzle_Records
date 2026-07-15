"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { generateDriveItemCaption } from "@/lib/drive/caption";

export function GenerateCaptionButton({ driveItemId }: { driveItemId: string }) {
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
            const result = await generateDriveItemCaption(driveItemId);
            setError(result.error ?? null);
          })
        }
      >
        <Sparkles className={isPending ? "animate-pulse" : undefined} />
        Gerar legenda
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
