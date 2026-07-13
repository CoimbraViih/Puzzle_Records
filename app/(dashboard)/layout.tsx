import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  countUnreadNotifications,
  listNotifications,
} from "@/lib/notifications/queries";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(),
    countUnreadNotifications(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar profile={profile} />
      <SidebarInset>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <SidebarTrigger className="md:hidden" />
          <div className="ml-auto">
            <NotificationBell
              initialNotifications={notifications}
              initialUnreadCount={unreadCount}
            />
          </div>
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
