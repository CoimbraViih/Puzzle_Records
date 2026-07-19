"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { refreshDriveMirror } from "@/lib/drive/actions";

export function DriveRefreshButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await refreshDriveMirror();
            setError(result.error ?? null);
          })
        }
      >
        <RefreshCw className={isPending ? "animate-spin" : undefined} />
        Atualizar agora
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
