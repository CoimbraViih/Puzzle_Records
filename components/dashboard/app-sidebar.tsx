"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logout } from "@/app/login/actions";
import { navGroupsForRole } from "@/components/dashboard/nav-items";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { Profile } from "@/lib/types/profile";
import { ROLE_LABELS } from "@/lib/types/profile";

export function AppSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const groups = navGroupsForRole(profile.role);
  const displayName = profile.full_name ?? profile.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground"
          >
            P
          </span>
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
              Puzzle Records
            </span>
            <span className="text-xs text-sidebar-foreground/60">Painel</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, index) => (
          <SidebarGroup key={group.label}>
            {index > 0 && <SidebarSeparator className="mb-2" />}
            <SidebarGroupLabel className="text-[0.6875rem] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        render={
                          <Link
                            href={item.url}
                            aria-current={isActive ? "page" : undefined}
                          />
                        }
                        isActive={isActive}
                        tooltip={item.title}
                        className="relative gap-2.5 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary before:opacity-0 before:transition-opacity data-active:before:opacity-100 data-active:text-sidebar-primary [&_svg]:text-sidebar-foreground/60 data-active:[&_svg]:text-sidebar-primary"
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator className="mb-2" />
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
              >
                {initial}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-sidebar-foreground">
                  {displayName}
                </span>
                <span className="text-xs text-sidebar-foreground/60">
                  {ROLE_LABELS[profile.role]}
                </span>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logout} className="contents">
              <SidebarMenuButton
                type="submit"
                tooltip="Sair"
                className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
              >
                <LogOut />
                <span>Sair</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
