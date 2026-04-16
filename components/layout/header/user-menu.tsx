"use client";

import { useSession } from "@/src/lib/session-client";
import { signOutAction } from "@/app/actions/auth/signout";
import { BadgeCheck, Bell, ChevronRightIcon, CreditCard, LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useTierQuota } from "@/src/hooks/useTierQuota";

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
  const { data: quota, isLoading: quotaLoading } = useTierQuota();
  const user = session?.user;
  const name = user?.name || "User";
  const email = user?.email || "";
  const image = user?.image;
  const initials = getInitials(name);

  const creditsUsed = quota?.usage.apiKeyCount ?? 0;
  const creditsTotal = quota?.config.maxAPIKeys ?? 0;
  const creditsLeft = creditsTotal === Infinity ? "\u221E" : Math.max(0, creditsTotal - creditsUsed);
  const progressPct = creditsTotal > 0 && creditsTotal !== Infinity
    ? Math.round((creditsUsed / creditsTotal) * 100)
    : 0;

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
        <DropdownMenuItem onClick={() => signOutAction("/dashboard/login/v2")}>
          <LogOut />
          Log out
        </DropdownMenuItem>
        <div className="bg-muted mt-1.5 rounded-md border">
          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">API Keys</h4>
              <div className="text-muted-foreground flex cursor-pointer items-center text-sm">
                {quotaLoading ? (
                  <Skeleton className="h-4 w-10" />
                ) : (
                  <span>{creditsLeft} left</span>
                )}
                <ChevronRightIcon className="ml-1 h-4 w-4" />
              </div>
            </div>
            {quotaLoading ? (
              <Skeleton className="h-2 w-full" />
            ) : (
              <Progress value={progressPct} indicatorColor="bg-primary" />
            )}
            <div className="text-muted-foreground flex items-center text-sm">
              {quota?.config.displayName ?? "—"} plan
            </div>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
