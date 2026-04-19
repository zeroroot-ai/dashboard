"use client";

/**
 * BillingContent
 * Gibson Enterprise billing overview with Plan & Usage card (plan header,
 * quota bars, feature list) plus Stripe customer-portal CTA.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  CreditCard,
  ExternalLink,
  Minus,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { useTierLimits } from "@/src/hooks/useTierLimits";
import { lookupPlan, type PlanID } from "@/src/generated/plans";
import {
  getTenantQuotaAction,
  type TenantQuotaRow,
} from "@/app/actions/read/getTenantQuota";

const UNLIMITED = -1;
const REFRESH_INTERVAL_MS = 60_000;
const SALES_EMAIL = "sales@zero-day.ai";

type FeatureRow =
  | { label: string; state: "on" | "off" }
  | { label: string; state: "priority" };

interface QuotaSpec {
  label: string;
  current: number;
  limit: number;
  description?: string;
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function formatLimit(limit: number): string {
  return limit === UNLIMITED ? "Unlimited" : fmt(limit);
}

function progressTone(percent: number, unlimited: boolean): string {
  if (unlimited) return "";
  if (percent >= 95) return "[&>div]:bg-red-500";
  if (percent >= 80) return "[&>div]:bg-amber-500";
  return "";
}

function featureRows(planId: PlanID): FeatureRow[] {
  const plan = lookupPlan(planId);
  const f = plan.features;
  // Priority Slack lights up at org tier (first has_dedicated_slack=true) —
  // render a "Priority" badge rather than a plain check.
  return [
    { label: "SSO (OIDC / SAML)", state: f.has_sso ? "on" : "off" },
    { label: "Audit log export", state: f.has_audit_logs ? "on" : "off" },
    {
      label: "Compliance exports",
      state: f.has_compliance_exports ? "on" : "off",
    },
    {
      label: "Dedicated Slack",
      state: f.has_dedicated_slack ? "priority" : "off",
    },
    {
      label: "Dedicated tenant",
      state: f.has_dedicated_tenant ? "on" : "off",
    },
    {
      label: "Private registry",
      state: f.has_private_registry ? "on" : "off",
    },
  ];
}

export function BillingContent() {
  const { data, isLoading, isError, error } = useTierLimits();
  const planId = (data?.config?.tier ?? "solo") as PlanID;
  const plan = useMemo(() => lookupPlan(planId), [planId]);

  const [quota, setQuota] = useState<TenantQuotaRow | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);

  const refreshQuota = useCallback(async () => {
    const r = await getTenantQuotaAction();
    if (r.ok) {
      setQuota(r.data);
      setQuotaError(null);
    } else {
      setQuotaError(r.error);
    }
    setQuotaLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshQuota();
    const tick = () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      refreshQuota();
    };
    const id = window.setInterval(tick, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshQuota]);

  async function handleManageSubscription() {
    if (plan.contactOnly) {
      window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
        `Gibson ${plan.displayName} — upgrade inquiry`,
      )}`;
      return;
    }
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

  const quotaSpecs: QuotaSpec[] = quota
    ? [
        {
          label: "Seats",
          current: quota.currentSeats,
          limit: plan.quotas.seats,
        },
        {
          label: "Concurrent agents",
          current: quota.currentConcurrentAgents,
          limit: plan.quotas.concurrent_agents,
        },
        {
          label: "Storage (GB)",
          current: quota.currentStorageGb,
          limit: plan.quotas.storage_gb,
        },
        {
          label: "Retention (days)",
          current: plan.quotas.retention_days === UNLIMITED
            ? 0
            : plan.quotas.retention_days,
          limit: plan.quotas.retention_days,
          description: "Retention window for audit / mission history.",
        },
        {
          label: "Sandbox launches / month",
          current: quota.currentSandboxLaunchesThisMonth,
          limit: plan.quotas.sandbox_launches_per_month,
        },
      ]
    : [];

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

      {/* Plan header card */}
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
                    <Skeleton className="h-3 w-56" />
                  </>
                ) : (
                  <>
                    <CardTitle className="text-base">
                      {plan.displayName}
                    </CardTitle>
                    <CardDescription className="mt-0.5 text-xs">
                      {plan.tagline}
                    </CardDescription>
                    <p className="text-muted-foreground mt-1 text-xs italic">
                      {plan.persona}
                    </p>
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
            <p className="text-muted-foreground text-xs">
              {plan.contactOnly
                ? "Contact sales to adjust seats or tier."
                : "Need to adjust seats or tier?"}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={handleManageSubscription}
              disabled={isLoading}
            >
              <CreditCard className="size-3.5" />
              {plan.contactOnly ? "Contact sales" : "Manage subscription"}
              <ExternalLink className="size-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Plan & Usage card — quota bars */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="text-primary size-4" />
            Plan &amp; Usage
          </CardTitle>
          <CardDescription className="text-xs">
            Current utilisation against plan quotas. Amber at 80%, red at 95%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {quotaError && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="size-4" />
              <AlertDescription className="text-xs">
                Usage temporarily unavailable — retry. ({quotaError})
              </AlertDescription>
            </Alert>
          )}
          {quotaLoading && !quotaError ? (
            <>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </>
          ) : (
            quotaSpecs.map((spec) => {
              const unlimited = spec.limit === UNLIMITED;
              const p = unlimited ? 0 : pct(spec.current, spec.limit);
              return (
                <div key={spec.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{spec.label}</span>
                    <span className="text-muted-foreground font-mono">
                      {unlimited
                        ? "Unlimited"
                        : `${fmt(spec.current)} / ${formatLimit(spec.limit)}`}
                    </span>
                  </div>
                  <Progress
                    value={unlimited ? 0 : p}
                    className={`h-1.5 ${
                      unlimited ? "opacity-30" : ""
                    } ${progressTone(p, unlimited)}`}
                    aria-label={spec.label}
                  />
                  {spec.description && (
                    <p className="text-muted-foreground text-[11px]">
                      {spec.description}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Feature availability card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Features included</CardTitle>
          <CardDescription className="text-xs">
            Platform capabilities available on your current plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {featureRows(planId).map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between text-xs"
            >
              <span className="font-medium">{row.label}</span>
              {row.state === "on" && (
                <Check className="text-primary size-4" aria-label="included" />
              )}
              {row.state === "priority" && (
                <Badge
                  variant="outline"
                  className="border-primary/40 bg-primary/10 text-primary text-[10px] uppercase tracking-wide"
                >
                  Priority
                </Badge>
              )}
              {row.state === "off" && (
                <Minus
                  className="text-muted-foreground size-4"
                  aria-label="not included"
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
