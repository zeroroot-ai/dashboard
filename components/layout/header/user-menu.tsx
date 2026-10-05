// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import { useSession } from "@/src/lib/session-client";
// Logout uses the federated-signout route, not next-auth's client-side
// signOut(). signOut() only clears the dashboard's Auth.js cookie, Zitadel
// keeps a parallel SSO cookie that silently re-authenticates the next call
// to /authorize. The route clears Auth.js AND redirects to Zitadel's
// end_session_endpoint with client_id. The route accepts POST only.
import { submitFederatedSignout } from "@/src/lib/auth/federated-signout-client";
import {
  BadgeCheck,
  Bell,
  CreditCard,
  LogOut,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useTierLimits } from "@/src/hooks/useTierLimits";

function getInitials(name?: string | null): string {
  if (!name) return "??";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function UserMenu() {
  const { data: session } = useSession();
  const { data: tier, isLoading: tierLoading } = useTierLimits();
  const user = session?.user;
  const name = user?.name || "User";
  const email = user?.email || "";
  const image = user?.image;
  const initials = getInitials(name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar>
          {image && <AvatarImage src={image} alt={name} />}
          <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-60" align="end">
        <DropdownMenuLabel className="p-0">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar>
              {image && <AvatarImage src={image} alt={name} />}
              <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{name}</span>
              <span className="text-muted-foreground truncate text-xs">{email}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <BadgeCheck />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CreditCard />
            Billing
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Bell />
            Notifications
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            submitFederatedSignout();
          }}
        >
          <LogOut />
          Log out
        </DropdownMenuItem>
        <div className="bg-muted mt-1.5 rounded-md border">
          <div className="text-muted-foreground flex items-center p-3 text-sm">
            {tierLoading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <span>{tier?.config.displayName ?? "-"} plan</span>
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
