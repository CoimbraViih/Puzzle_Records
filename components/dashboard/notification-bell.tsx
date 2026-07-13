"use client";

import { Bell } from "lucide-react";
import { useState, useTransition } from "react";

import { markAllNotificationsRead } from "@/lib/notifications/actions";
import type { NotificationRow } from "@/lib/notifications/queries";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationRow[];
  initialUnreadCount: number;
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [, startTransition] = useTransition();

  function handleOpenChange(open: boolean) {
    if (open && unreadCount > 0) {
      setUnreadCount(0);
      setNotifications((current) =>
        current.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
      );
      startTransition(() => {
        markAllNotificationsRead();
      });
    }
  }

  return (
    <Sheet onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative">
            <Bell />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[0.625rem] font-medium text-destructive-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
            <span className="sr-only">Notificações</span>
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Notificações</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          {notifications.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma notificação por enquanto.
            </p>
          )}
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="rounded-lg border border-border bg-card p-3 text-sm text-card-foreground"
            >
              <p>{notification.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTimestamp(notification.created_at)}
              </p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
