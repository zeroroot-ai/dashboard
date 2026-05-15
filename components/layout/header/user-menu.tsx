"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import { useSession } from "@/src/lib/session-client";
// Logout uses the federated-signout route, not next-auth's client-side
// signOut(). signOut() only clears the dashboard's Auth.js cookie — Zitadel
// keeps a parallel SSO cookie that silently re-authenticates the next call
// to /authorize. /api/auth/federated-signout clears Auth.js AND redirects
// to Zitadel's end_session_endpoint with id_token_hint.
import {
  BadgeCheck,
  Bell,
  ChevronRightIcon,
  CreditCard,
  LogOut,
  MonitorIcon,
  MoonIcon,
  Palette,
  SunIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useTierQuota } from "@/src/hooks/useTierQuota";

/**
 * Per-decision (#57 sub-decision 2): theme persistence is per-user, syncing
 * across devices. The dashboard's only existing user-pref persistence layer
 * is the `theme_*` cookie pattern (per-browser). Until a real per-user pref
 * store is introduced, we mirror next-themes' localStorage write to a
 * `theme_choice` cookie so layout.tsx can read it server-side and avoid the
 * dark-flash on light-themed signed-in sessions. Marked follow-up.
 */
function setThemeCookie(value: string | null) {
  if (typeof document === "undefined") return;
  if (!value) {
    document.cookie =
      "theme_choice=; path=/; max-age=0; SameSite=Lax" +
      (window.location.protocol === "https:" ? "; Secure" : "");
    return;
  }
  document.cookie =
    `theme_choice=${value}; path=/; max-age=31536000; SameSite=Lax` +
    (window.location.protocol === "https:" ? "; Secure" : "");
}

function ThemePicker() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={mounted ? (theme ?? "system") : "system"}
          onValueChange={(value) => {
            setTheme(value);
            setThemeCookie(value);
          }}
        >
          <DropdownMenuRadioItem value="light">
            <SunIcon className="mr-2 h-4 w-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon className="mr-2 h-4 w-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon className="mr-2 h-4 w-4" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

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
          <ThemePicker />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            window.location.href = "/api/auth/federated-signout";
          }}
        >
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
