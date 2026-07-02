"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar
} from "@/components/ui/sidebar";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BotIcon,
  UserIcon,
  UsersIcon,
  ChevronRight,
  CrosshairIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  ListTreeIcon,
  MessageSquareIcon,
  NetworkIcon,
  Plug2Icon,
  RocketIcon,
  ServerIcon,
  SettingsIcon,
  ShieldCheckIcon,
  WrenchIcon,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

type NavGroup = {
  title: string;
  items: NavItem;
};

type NavItem = {
  title: string;
  href: string;
  icon?: LucideIcon;
  isComing?: boolean;
  isDataBadge?: string;
  isNew?: boolean;
  newTab?: boolean;
  items?: NavItem;
}[];

export const navItems: NavGroup[] = [
  {
    title: "Operations",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboardIcon
      },
      {
        title: "Missions",
        href: "/dashboard/missions",
        icon: CrosshairIcon
      },
      {
        title: "Targets",
        href: "/dashboard/targets",
        icon: ServerIcon
      },
      {
        title: "Mission Results",
        href: "/dashboard/results",
        icon: ClipboardListIcon
      },
      {
        title: "World",
        href: "/dashboard/world",
        icon: GlobeIcon
      },
      {
        title: "Findings",
        href: "/dashboard/findings",
        icon: AlertTriangleIcon
      },
      {
        title: "Review Queue",
        href: "/dashboard/review",
        icon: ClipboardCheckIcon
      },
      {
        title: "Traces",
        href: "/dashboard/traces",
        icon: ListTreeIcon
      },
      {
        title: "Knowledge Graph",
        href: "/dashboard/graph",
        icon: NetworkIcon
      },
      {
        title: "Agents",
        href: "/dashboard/agents",
        icon: BotIcon
      },
      {
        title: "Tools",
        href: "/dashboard/tools",
        icon: WrenchIcon
      },
      {
        title: "Plugins",
        href: "/dashboard/plugins",
        icon: Plug2Icon
      },
      {
        title: "Deploy",
        href: "/dashboard/deploy",
        icon: RocketIcon
      },
      {
        title: "Chat",
        href: "/dashboard/chat",
        icon: MessageSquareIcon,
        isNew: true
      },
      {
        title: "Events",
        href: "/dashboard/events",
        icon: ActivityIcon
      }
    ]
  },
  {
    // Single "Members & Access" home (industry pattern, GitLab/Linear/Vercel
    // keep people, teams, and access policy together in the workspace area
    // instead of a second member list under personal Settings).
    title: "Members & Access",
    items: [
      {
        title: "Members",
        href: "/dashboard/organization/users",
        icon: UserIcon,
      },
      {
        title: "Teams",
        href: "/dashboard/organization/teams",
        icon: UsersIcon,
      },
      {
        title: "Security Policy",
        href: "/dashboard/organization/security-policy",
        icon: ShieldCheckIcon,
      },
    ],
  },
  {
    title: "Configuration",
    items: [
      {
        // The settings index redirects to /pages/settings/account. The
        // settings page itself has its own sidebar with the full surface
        // (Account, Billing, Providers, Agents, Plugins, Model Access,
        // Budgets, plus admin-gated Secrets/Grants), so we don't repeat
        // it here.
        title: "Settings",
        href: "/dashboard/pages/settings/account",
        icon: SettingsIcon,
      },
    ],
  },
];

export function NavMain() {
  const pathname = usePathname();
  const { isMobile } = useSidebar();

  return (
    <>
      {navItems.map((nav) => (
        <SidebarGroup key={nav.title}>
          <SidebarGroupLabel>{nav.title}</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {nav.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {Array.isArray(item.items) && item.items.length > 0 ? (
                    <>
                      <div className="hidden group-data-[collapsible=icon]:block">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuButton tooltip={item.title}>
                              {item.icon && <item.icon />}
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </SidebarMenuButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            side={isMobile ? "bottom" : "right"}
                            align={isMobile ? "end" : "start"}
                            className="min-w-48 rounded-lg">
                            <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
                            {item.items?.map((item) => (
                              <DropdownMenuItem
                                className="hover:text-foreground active:text-foreground hover:bg-[var(--primary)]/10! active:bg-[var(--primary)]/10!"
                                asChild
                                key={item.title}>
                                <a href={item.href}>{item.title}</a>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <Collapsible
                        className="group/collapsible block group-data-[collapsible=icon]:hidden"
                        defaultOpen={!!item.items.find((s) => s.href === pathname)}>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            className="hover:text-foreground active:text-foreground hover:bg-[var(--primary)]/10 active:bg-[var(--primary)]/10"
                            tooltip={item.title}>
                            {item.icon && <item.icon />}
                            <span>{item.title}</span>
                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item?.items?.map((subItem, key) => (
                              <SidebarMenuSubItem key={key}>
                                <SidebarMenuSubButton
                                  className="hover:text-foreground active:text-foreground hover:bg-[var(--primary)]/10 active:bg-[var(--primary)]/10"
                                  isActive={pathname === subItem.href}
                                  asChild>
                                  <Link href={subItem.href} target={subItem.newTab ? "_blank" : ""} rel={subItem.newTab ? "noopener noreferrer" : undefined}>
                                    <span>{subItem.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </Collapsible>
                    </>
                  ) : (
                    <SidebarMenuButton
                      className="hover:text-foreground active:text-foreground hover:bg-[var(--primary)]/10 active:bg-[var(--primary)]/10"
                      isActive={pathname === item.href}
                      tooltip={item.title}
                      asChild>
                      <Link href={item.href} target={item.newTab ? "_blank" : ""} rel={item.newTab ? "noopener noreferrer" : undefined}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                  {!!item.isComing && (
                    <SidebarMenuBadge className="peer-hover/menu-button:text-foreground opacity-50">
                      Coming
                    </SidebarMenuBadge>
                  )}
                  {!!item.isNew && (
                    <SidebarMenuBadge className="border border-highlight/40 text-highlight peer-hover/menu-button:text-highlight">
                      New
                    </SidebarMenuBadge>
                  )}
                  {!!item.isDataBadge && (
                    <SidebarMenuBadge className="peer-hover/menu-button:text-foreground">
                      {item.isDataBadge}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
