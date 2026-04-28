"use client";

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
  LockKeyholeIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

const gibsonNavItems = [
  {
    title: "Providers",
    href: "/dashboard/pages/settings/providers",
    icon: BotIcon
  },
  {
    title: "Audit Log",
    href: "/dashboard/pages/settings/audit",
    icon: ClipboardListIcon
  },
  {
    title: "Permissions",
    href: "/dashboard/pages/settings/permissions",
    icon: LockKeyholeIcon
  },
  {
    title: "Agents",
    href: "/dashboard/pages/settings/agents",
    icon: CpuIcon
  }
];

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

          {gibsonNavItems.map((item) => (
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
        </nav>
      </CardContent>
    </Card>
  );
}
