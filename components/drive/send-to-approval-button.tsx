"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sendDriveItemToApproval } from "@/lib/drive/sendToApproval";

export function SendToApprovalButton({ driveItemId }: { driveItemId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="default"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await sendDriveItemToApproval(driveItemId);
            setError(result.error ?? null);
          })
        }
      >
        <Send className={isPending ? "animate-pulse" : undefined} />
        Enviar para aprovação
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
