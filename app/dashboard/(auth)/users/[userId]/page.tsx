"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/src/lib/session-client";
import { useTenantId } from "@/src/lib/auth/tenant";
import { ArrowLeft, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useCRDWatch } from "@/src/hooks/useCRDWatch";

const ROLE_BADGE_CLASS: Record<string, string> = {
  admin: "border-primary/50 bg-primary/10 text-primary",
  member: "border-blue-500/50 bg-blue-950/20 text-blue-400",
  viewer: "border-border bg-muted/50 text-muted-foreground",
};

function getInitials(name?: string | null): string {
  if (!name) return "??";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function tenantNamespace(name: string): string {
  return `tenant-${name}`;
}

export default function UserDetailPage() {
  const params = useParams();
  const userId = params.userId as string;

  const { data: session } = useSession();
  const tenantId = useTenantId() ?? "";
  const currentUserId = session?.user?.id ?? "";
  const isSelf = userId === currentUserId;

  const namespace = tenantId ? tenantNamespace(tenantId) : undefined;
  const { items, status } = useCRDWatch("TenantMember", namespace, {
    enabled: !!tenantId,
  });

  const member = React.useMemo(
    () =>
      items.find(
        (m) => m.status?.userId === userId || m.metadata.name === userId,
      ),
    [items, userId],
  );

  const isLoading = status === "connecting" || status === "idle";

  return (
    <div className="space-y-4">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="gap-1.5 text-muted-foreground"
        >
          <Link href="/dashboard/users">
            <ArrowLeft className="size-3.5" />
            Users
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight font-mono text-glow-green lg:text-2xl">
          User Details
        </h1>
        <p className="text-sm text-muted-foreground font-mono">
          <span className="data-value text-xs">{userId}</span>
        </p>
      </div>

      <Separator className="bg-green-900/20" />

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="glass-hack border-0">
              <CardContent className="space-y-4 pt-6">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Not found */}
      {!isLoading && !member && (
        <Card className="glass-hack border-0">
          <CardContent className="py-12 text-center text-muted-foreground">
            User not found.{" "}
            <Link href="/dashboard/users" className="text-primary hover:underline">
              Back to users
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {!isLoading && member && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="glass-hack border-0">
              <CardHeader>
                <CardTitle className="font-mono text-base">Profile</CardTitle>
                <CardDescription>User account information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback className="text-lg">
                      {getInitials(member.spec.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-lg font-medium">
                      {member.spec.email.split("@")[0]}
                    </p>
                    <p className="data-value text-sm text-muted-foreground">
                      {member.spec.email}
                    </p>
                  </div>
                </div>

                <Separator className="bg-green-900/20" />

                <div className="space-y-2">
                  <label className="font-mono text-sm text-muted-foreground">
                    Role
                  </label>
                  <Badge
                    variant="outline"
                    className={`text-xs font-mono ${ROLE_BADGE_CLASS[member.spec.role] ?? ROLE_BADGE_CLASS.viewer}`}
                  >
                    {member.spec.role}
                    {isSelf && " (you)"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Status
                    </p>
                    <p className="text-sm">
                      {member.status?.phase ?? "Pending"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Invited
                    </p>
                    <p className="text-sm tabular-nums">
                      {member.metadata.creationTimestamp
                        ? new Date(member.metadata.creationTimestamp).toLocaleDateString()
                        : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="glass-hack border-0">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-green-500" aria-hidden="true" />
                  <CardTitle className="font-mono text-base">
                    Account Management
                  </CardTitle>
                </div>
                <CardDescription>
                  Session management, password, and MFA are handled by your identity provider.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  To view or revoke active sessions and manage account security, visit your identity provider&apos;s profile page.
                </p>
                <a
                  href={
                    (process.env.NEXT_PUBLIC_IDENTITY_PROVIDER_URL
                      ? `${process.env.NEXT_PUBLIC_IDENTITY_PROVIDER_URL}/ui/console`
                      : '#')
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  Manage account at provider
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
