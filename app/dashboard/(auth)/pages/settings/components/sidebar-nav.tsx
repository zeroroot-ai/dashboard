// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import {
  BotIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  DollarSignIcon,
  KeyIcon,
  ScaleIcon,
  ShieldIcon,
  TerminalIcon,
  UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { useTenantId } from "@/src/lib/auth/tenant";
import { useTenantContext } from "@/src/lib/tenant-context";
import type { AccountLink } from "@/src/lib/deployment-profile";

/**
 * Settings sidebar.
 *
 * Three sections, each a flat list (no nested items):
 *
 *   Account   , user-prefs surfaces every member sees, plus the account
 *                link from config, which only the tenant Owner sees
 *   Workspace , Gibson product surfaces (LLM providers, agents, plugins, …)
 *   Admin     , admin-gated surfaces hidden via useAuthorize() until the
 *                membership query confirms tenant_admin
 *
 * Items removed from the prior layout:
 *   - "Profile"    , duplicated /pages/settings/account; the index page
 *                     now redirects there.
 *   - "Appearance" , was a template form with no persistence.
 *   - "Notifications", "Display", same.
 *   - "Audit Log", "Permissions", pointed at routes that don't exist.
 */

const accountNav = [
  { title: "Profile", href: "/dashboard/pages/settings/account", icon: UserIcon },
  { title: "CLI", href: "/dashboard/pages/settings/cli", icon: TerminalIcon },
];

const workspaceNav = [
  { title: "Providers", href: "/dashboard/pages/settings/providers", icon: BotIcon },
  // Agents, Plugins, and Connectors live as top-level dashboard sections
  // (left-bar nav); the deploy wizard for both is reachable from those pages.
  { title: "Model Access", href: "/dashboard/pages/settings/model-access", icon: ScaleIcon },
  { title: "Budgets", href: "/dashboard/pages/settings/budgets", icon: DollarSignIcon },
];

interface AdminEntry {
  title: string;
  href: string;
  icon: React.ElementType;
  /** RPC method to authorize against. Hidden when not allowed. */
  method: string;
}

// Member management is NOT in Settings, it lives in the single "Members &
// Access" home under the Organization nav (Members / Teams / Security Policy),
// per dashboard#609. /dashboard/pages/settings/members redirects there.

const adminNav: AdminEntry[] = [
  {
    title: "Secrets",
    href: "/dashboard/pages/settings/secrets",
    icon: KeyIcon,
    method: "/gibson.secrets.v1.SecretsService/ListSecrets",
  },
  {
    title: "Secret Broker",
    href: "/dashboard/pages/settings/secrets-backend",
    icon: DatabaseIcon,
    method: "/gibson.secrets.v1.SecretsService/GetBrokerConfig",
  },
  {
    title: "Permissions",
    href: "/dashboard/pages/settings/grants",
    icon: ShieldIcon,
    method: "/gibson.tenant.v1.GrantsService/ListActiveGrants",
  },
];

function NavLink({
  title,
  href,
  icon: Icon,
  pathname,
}: {
  title: string;
  href: string;
  icon: React.ElementType;
  pathname: string;
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "hover:bg-muted justify-start",
        pathname === href ? "bg-muted hover:bg-muted" : "",
      )}
      asChild
    >
      <Link href={href}>
        <Icon />
        {title}
      </Link>
    </Button>
  );
}

function GatedNavLink({
  title,
  href,
  icon,
  method,
  pathname,
}: AdminEntry & { pathname: string }) {
  const { allowed, loading } = useAuthorize(method);
  if (loading || !allowed) return null;
  return <NavLink title={title} href={href} icon={icon} pathname={pathname} />;
}

/**
 * The account link from config (dashboard#226). Only the tenant Owner sees it.
 * The service behind the URL checks the role again, so hiding the link is a
 * convenience, not the control. The label comes from config; the source holds
 * no text for it.
 */
function AccountLinkEntry({ link }: { link: AccountLink }) {
  const tenantId = useTenantId() ?? "";
  const { rolesByTenant } = useTenantContext();
  const isOwner = tenantId !== "" && rolesByTenant[tenantId] === "owner";
  if (!isOwner) return null;
  return (
    <Button variant="ghost" className="hover:bg-muted justify-start" asChild>
      <a href={link.url}>
        <ExternalLinkIcon />
        {link.label}
      </a>
    </Button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-3">
      <Separator className="mb-2" />
      <p className="text-muted-foreground px-1 pb-1 text-[10px] font-medium uppercase tracking-widest">
        {children}
      </p>
    </div>
  );
}

export function SidebarNav({ accountLink }: { accountLink: AccountLink | null }) {
  const pathname = usePathname();

  return (
    <Card className="py-0">
      <CardContent className="p-2">
        <nav className="flex flex-col space-y-0.5 space-x-2 lg:space-x-0">
          <SectionLabel>Personal</SectionLabel>
          {accountNav.map((item) => (
            <NavLink key={item.href} {...item} pathname={pathname} />
          ))}
          {accountLink ? <AccountLinkEntry link={accountLink} /> : null}

          <SectionLabel>Workspace</SectionLabel>
          {workspaceNav.map((item) => (
            <NavLink key={item.href} {...item} pathname={pathname} />
          ))}

          <SectionLabel>Administration</SectionLabel>
          {adminNav.map((item) => (
            <GatedNavLink key={item.href} {...item} pathname={pathname} />
          ))}
        </nav>
      </CardContent>
    </Card>
  );
}
