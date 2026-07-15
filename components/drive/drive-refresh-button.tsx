"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { refreshDriveMirror } from "@/lib/drive/actions";

export function DriveRefreshButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => refreshDriveMirror())}
    >
      <RefreshCw className={isPending ? "animate-spin" : undefined} />
      Atualizar agora
    </Button>
  );
}
