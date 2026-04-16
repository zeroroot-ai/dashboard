"use client";

/**
 * BillingContent
 * Gibson Enterprise billing and usage overview panel.
 */

import { AlertCircle, Building2, CreditCard, ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { useTierLimits } from "@/src/hooks/useTierLimits";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(used: number, limit: number | null): number {
  if (limit === null || limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function formatLimit(limit: number): string {
  return limit === Infinity ? "unlimited" : fmt(limit);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function BillingContent() {
  const { data, isLoading, isError, error } = useTierLimits();

  const config = data?.config;
  const usage = data?.usage;

  async function handleManageSubscription() {
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const body = await response.json();
      if (body?.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (err) {
      toast.error("Failed to open billing portal", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return (
    <div className="space-y-4">
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">
            {error?.message ?? "Failed to load billing information."}
          </AlertDescription>
        </Alert>
      )}

      {/* Plan card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="border-primary/30 bg-primary/10 flex h-9 w-9 items-center justify-center rounded-md border">
                <Building2 className="text-primary size-4" />
              </div>
              <div>
                {isLoading ? (
                  <>
                    <Skeleton className="h-5 w-32 mb-1" />
                    <Skeleton className="h-3 w-44" />
                  </>
                ) : (
                  <>
                    <CardTitle className="text-base">
                      {config?.displayName ?? "—"}
                    </CardTitle>
                    <CardDescription className="mt-0.5 text-xs">
                      {config?.maxTeamMembers === Infinity
                        ? "Unlimited seats"
                        : `Up to ${config?.maxTeamMembers ?? "—"} seats`}
                      {usage
                        ? ` \u00b7 ${usage.teamMemberCount} member${usage.teamMemberCount !== 1 ? "s" : ""}`
                        : ""}
                    </CardDescription>
                  </>
                )}
              </div>
            </div>
            <Badge variant="success" className="shrink-0 text-xs">
              Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">Need to adjust seats or tier?</p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={handleManageSubscription}
              disabled={isLoading}
            >
              <CreditCard className="size-3.5" />
              Manage subscription
              <ExternalLink className="size-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Usage metrics */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="text-primary size-4" />
            Plan limits
          </CardTitle>
          <CardDescription className="text-xs">
            Current utilisation against plan limits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </>
          ) : (
            <>
              {/* Team members */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Team members</span>
                  <span className="text-muted-foreground font-mono">
                    {fmt(usage?.teamMemberCount ?? 0)} / {formatLimit(config?.maxTeamMembers ?? 0)}
                  </span>
                </div>
                <Progress
                  value={pct(
                    usage?.teamMemberCount ?? 0,
                    config?.maxTeamMembers === Infinity ? null : (config?.maxTeamMembers ?? null)
                  )}
                  className="h-1.5"
                />
              </div>

              {/* API keys */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">API keys (per user)</span>
                  <span className="text-muted-foreground font-mono">
                    {fmt(usage?.apiKeyCount ?? 0)} / {formatLimit(config?.maxAPIKeys ?? 0)}
                  </span>
                </div>
                <Progress
                  value={pct(
                    usage?.apiKeyCount ?? 0,
                    config?.maxAPIKeys === Infinity ? null : (config?.maxAPIKeys ?? null)
                  )}
                  className="h-1.5"
                />
              </div>

              {/* Custom roles */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Custom roles</span>
                  <span className="text-muted-foreground font-mono">
                    {fmt(usage?.customRoleCount ?? 0)} /{" "}
                    {config?.customRolesEnabled ? "unlimited" : "not available"}
                  </span>
                </div>
                <Progress
                  value={config?.customRolesEnabled ? 0 : 100}
                  className={`h-1.5 ${!config?.customRolesEnabled ? "opacity-30" : ""}`}
                />
              </div>

              {/* Pending invitations */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Pending invitations</span>
                  <span className="text-muted-foreground font-mono">
                    {fmt(usage?.pendingInvitationCount ?? 0)}
                  </span>
                </div>
                <Progress value={0} className="h-1.5 opacity-30" />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
