// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import type * as React from "react";

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
import { RunningAgentsBadge } from "@/components/gibson/agent-console/RunningAgentsBadge";
import { ComplianceNavGate } from "@/components/gibson/compliance/ComplianceNavGate";
import { COMPLIANCE_MENU_TITLE } from "@/components/gibson/compliance/texts";
import { AuthorizedNavGate } from "@/components/gibson/auth/AuthorizedNavGate";
import { AUDIT_TEXT } from "@/components/gibson/audit-log/texts";
import { ONTOLOGY_TEXT } from "@/components/gibson/ontology-proposals/texts";
import { RegistrationsNavGate } from "@/components/gibson/registrations/RegistrationsNavGate";
import { REGISTRATIONS_TEXT } from "@/components/gibson/registrations/texts";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BookOpenIcon,
  BotIcon,
  BoxIcon,
  CableIcon,
  UserIcon,
  UserCheckIcon,
  UsersIcon,
  ChevronRight,
  CrosshairIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  GaugeIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  GavelIcon,
  ListTreeIcon,
  MessageSquareIcon,
  NetworkIcon,
  Plug2Icon,
  RocketIcon,
  ScrollTextIcon,
  ServerIcon,
  SettingsIcon,
  ShieldAlertIcon,
  FileTextIcon,
  TerminalIcon,
  LayersIcon,
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

/** A menu gate. Each value names a component that hides its entry. */
type NavGate = "compliance" | "registrations" | "ontology" | "audit";

type NavGroup = {
  title: string;
  /** A gate on the whole group, label included. Same values as NavItem.gate. */
  gate?: NavGate;
  items: NavItem;
};

type NavItem = {
  title: string;
  href: string;
  icon?: LucideIcon;
  isComing?: boolean;
  isDataBadge?: string;
  isNew?: boolean;
  /** Live count of the tenant's running agents (the console entry). */
  liveBadge?: "running-agents";
  /**
   * "compliance": the entry shows only for the Owner and the Admin, and only
   * when the tenant enabled a compliance pack (D56).
   * "registrations": the entry shows only for a caller that may read the
   * registration queue, the Platform owner (dashboard#193).
   * "ontology" and "audit": the entry shows only for the Owner and the
   * Admin, the roles that may call the page's RPC (dashboard#191, G23).
   */
  gate?: NavGate;
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
        // The HITL settle queue (ADR-0123, dashboard#97): a human judges the
        // bets the fleet is unsure about, and every verdict feeds the learning
        // loop. Distinct from the review queue, which labels surfaced surprises.
        title: "Settle Queue",
        href: "/dashboard/hitl-settle",
        icon: GavelIcon
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
        // The reliability diagram (ADR-0122, dashboard#98): the visible proof
        // that the fleet's confidence numbers are calibrated against outcomes.
        title: "Reliability",
        href: "/dashboard/reliability",
        icon: GaugeIcon
      },
      {
        // The ontology proposals of the agents (ADR-0033 decision 3,
        // dashboard#191): the Owner approves what agents propose.
        title: ONTOLOGY_TEXT.menu,
        href: "/dashboard/organization/ontology-proposals",
        icon: BookOpenIcon,
        gate: "ontology"
      },
      {
        title: "Agents",
        href: "/dashboard/agents",
        icon: BotIcon
      },
      {
        title: "Banks",
        href: "/dashboard/agents/banks",
        icon: LayersIcon
      },
      {
        title: "Sandboxes",
        href: "/dashboard/sandboxes",
        icon: TerminalIcon,
        liveBadge: "running-agents"
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
        // Connectors are a first-class component kind, a peer of plugins and
        // tools (ADR-0065), so they sit in the primary nav rather than under
        // Settings.
        title: "Connectors",
        href: "/dashboard/connectors",
        icon: CableIcon
      },
      {
        // Domain Packs are a curated, per-tenant enable/disable catalog
        // (ADR-0133, gibson#383), the same shape as Connectors, so it sits
        // beside it in the primary nav.
        title: "Domain Packs",
        href: "/dashboard/domain-packs",
        icon: BoxIcon
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
      },
      {
        // The destructive-action authorization queue (ADR-0132, dashboard#99):
        // a human authorizes each irreversible demonstration before it runs.
        // The gate is per-action, never per-mission.
        title: "Authorizations",
        href: "/dashboard/destructive-actions",
        icon: ShieldAlertIcon
      },
      {
        // The compliance evidence page (ADR-0113, D56). Evidence only, never
        // a verdict.
        title: COMPLIANCE_MENU_TITLE,
        href: "/dashboard/compliance",
        icon: FileTextIcon,
        gate: "compliance"
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
      {
        // The audit log of the organization (lane 11 row G23): who did
        // what, as which kind of actor, to which object.
        title: AUDIT_TEXT.menu,
        href: "/dashboard/organization/audit-log",
        icon: ScrollTextIcon,
        gate: "audit",
      },
    ],
  },
  {
    // The Platform owner's surface. The whole group, label included, shows
    // only for a caller that may read the registration queue.
    title: "Platform",
    gate: "registrations",
    items: [
      {
        // The registration queue of the approval rung (ADR-0074,
        // dashboard#193).
        title: REGISTRATIONS_TEXT.menu,
        href: "/dashboard/admin/registrations",
        icon: UserCheckIcon,
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

/** The RPC that each RPC-gated entry needs. */
const GATE_METHOD = {
  ontology: "/gibson.tenant.v1.OntologyExtensionService/ListOntologyExtensionProposals",
  audit: "/gibson.tenant.v1.TenantService/ListAuditEvents",
} as const;

function GatedItem({
  gate,
  children,
}: {
  gate?: NavGate;
  children: React.ReactNode;
}) {
  if (gate === "compliance") return <ComplianceNavGate>{children}</ComplianceNavGate>;
  if (gate === "registrations") return <RegistrationsNavGate>{children}</RegistrationsNavGate>;
  if (gate === "ontology" || gate === "audit") {
    return <AuthorizedNavGate method={GATE_METHOD[gate]}>{children}</AuthorizedNavGate>;
  }
  return <>{children}</>;
}

export function NavMain() {
  const pathname = usePathname();
  const { isMobile } = useSidebar();

  return (
    <>
      {navItems.map((nav) => (
        <GatedItem key={nav.title} gate={nav.gate}>
        <SidebarGroup>
          <SidebarGroupLabel>{nav.title}</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {nav.items.map((item) => (
                <GatedItem key={item.title} gate={item.gate}>
                <SidebarMenuItem>
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
                  {item.liveBadge === "running-agents" && <RunningAgentsBadge />}
                  {!!item.isDataBadge && (
                    <SidebarMenuBadge className="peer-hover/menu-button:text-foreground">
                      {item.isDataBadge}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
                </GatedItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        </GatedItem>
      ))}
    </>
  );
}
