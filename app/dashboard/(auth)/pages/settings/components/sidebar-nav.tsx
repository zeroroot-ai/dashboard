"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import {
  BellIcon,
  BotIcon,
  ClipboardListIcon,
  ContrastIcon,
  CreditCardIcon,
  CpuIcon,
  DatabaseIcon,
  KeyIcon,
  LockKeyholeIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

const sidebarNavItems = [
  {
    title: "Profile",
    href: "/dashboard/pages/settings",
    icon: UserIcon
  },
  {
    title: "Account",
    href: "/dashboard/pages/settings/account",
    icon: ShieldIcon
  },
  {
    title: "Billing",
    href: "/dashboard/pages/settings/billing",
    icon: CreditCardIcon
  },
  {
    title: "Appearance",
    href: "/dashboard/pages/settings/appearance",
    icon: PaletteIcon
  },
  {
    title: "Notifications",
    href: "/dashboard/pages/settings/notifications",
    icon: BellIcon
  },
  {
    title: "Display",
    href: "/dashboard/pages/settings/display",
    icon: ContrastIcon
  }
];

// Non-gated Gibson nav items (all members can see).
const gibsonNavItemsPublic = [
  {
    title: "Providers",
    href: "/dashboard/pages/settings/providers",
    icon: BotIcon,
  },
  {
    title: "Audit Log",
    href: "/dashboard/pages/settings/audit",
    icon: ClipboardListIcon,
  },
  {
    title: "Permissions",
    href: "/dashboard/pages/settings/permissions",
    icon: LockKeyholeIcon,
  },
  {
    title: "Agents",
    href: "/dashboard/pages/settings/agents",
    icon: CpuIcon,
  },
];

/**
 * GatedNavItem — renders a nav button only when the given RPC is authorized.
 * Hides on loading=true (no FOUC). Spec: dashboard-authz-ui-gating Task 11.
 */
function GatedNavItem({
  title,
  href,
  icon: Icon,
  method,
  pathname,
}: {
  title: string;
  href: string;
  icon: React.ElementType;
  method: string;
  pathname: string;
}) {
  const { allowed, loading } = useAuthorize(method);
  if (loading || !allowed) return null;
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

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <Card className="py-0">
      <CardContent className="p-2">
        <nav className="flex flex-col space-y-0.5 space-x-2 lg:space-x-0">
          {sidebarNavItems.map((item) => (
            <Button
              key={item.href}
              variant="ghost"
              className={cn(
                "hover:bg-muted justify-start",
                pathname === item.href ? "bg-muted hover:bg-muted" : ""
              )}
              asChild>
              <Link href={item.href}>
                {item.icon && <item.icon />}
                {item.title}
              </Link>
            </Button>
          ))}

          <div className="px-2 pb-1 pt-3">
            <Separator className="mb-2" />
            <p className="text-muted-foreground px-1 pb-1 text-[10px] font-medium uppercase tracking-widest">
              Gibson
            </p>
          </div>

          {gibsonNavItemsPublic.map((item) => (
            <Button
              key={item.href}
              variant="ghost"
              className={cn(
                "hover:bg-muted justify-start",
                pathname === item.href ? "bg-muted hover:bg-muted" : "",
              )}
              asChild
            >
              <Link href={item.href}>
                <item.icon />
                {item.title}
              </Link>
            </Button>
          ))}

          {/* Admin-only entries: gated via useAuthorize on the primary read RPC.
              Hidden on loading=true to prevent FOUC. */}
          <GatedNavItem
            title="Secrets"
            href="/dashboard/pages/settings/secrets"
            icon={KeyIcon}
            method="/gibson.admin.v1.SecretsAdminService/ListSecrets"
            pathname={pathname}
          />
          <GatedNavItem
            title="Secrets Backend"
            href="/dashboard/pages/settings/secrets-backend"
            icon={DatabaseIcon}
            method="/gibson.admin.v1.TenantAdminService/GetBrokerConfig"
            pathname={pathname}
          />
          <GatedNavItem
            title="Grants"
            href="/dashboard/pages/settings/grants"
            icon={ShieldIcon}
            method="/gibson.admin.v1.GrantsAdminService/ListActiveGrants"
            pathname={pathname}
          />
        </nav>
      </CardContent>
    </Card>
  );
}
