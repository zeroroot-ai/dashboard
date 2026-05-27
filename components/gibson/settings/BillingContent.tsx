"use client";

/**
 * BillingContent — Settings → Billing page.
 *
 * Spec plans-and-quotas-simplification simplifies this surface: plan
 * name + the two enforced quotas (concurrent_missions, concurrent_agents)
 * with usage bars + a tier-aware upgrade CTA + Stripe Customer Portal
 * entry for managing payment / cancellation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, ExternalLink, AlertCircle } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";

import { lookupPlan, type PlanID } from "@/src/generated/plans";
import { getUpgradeTarget } from "@/src/lib/billing/upgrade-target";
import {
  getTenantQuotaAction,
  type TenantQuotaRow,
} from "@/app/actions/read/getTenantQuota";

const REFRESH_INTERVAL_MS = 60_000;

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

interface QuotaCardProps {
  label: string;
  description: string;
  used: number;
  limit: number;
}

function QuotaCard({ label, description, used, limit }: QuotaCardProps) {
  if (limit === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{label}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">Unlimited</div>
        </CardContent>
      </Card>
    );
  }
  const pctVal = pct(used, limit);
  const variant =
    pctVal >= 100 ? "destructive" : pctVal >= 80 ? "secondary" : "outline";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-2xl font-semibold tabular-nums">
            {used}
            <span className="text-muted-foreground/60 text-base"> / {limit}</span>
          </div>
          <Badge variant={variant}>{pctVal}%</Badge>
        </div>
        <Progress value={pctVal} className="h-2" />
      </CardContent>
    </Card>
  );
}

export function BillingContent() {
  const [data, setData] = useState<TenantQuotaRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getTenantQuotaAction();
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const plan = useMemo(() => {
    const id = (data?.planId ?? "") as PlanID;
    if (!id) return null;
    try {
      return lookupPlan(id);
    } catch {
      return null;
    }
  }, [data?.planId]);

  const upgrade = getUpgradeTarget(plan?.id);

  async function openCustomerPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { url?: string };
      if (json.url) {
        window.location.href = json.url;
      } else {
        throw new Error("portal returned no URL");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to open Stripe portal",
      );
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {error}
        </AlertDescription>
      </Alert>
    );
  }

  if (!plan) {
    // Unknown or empty plan ID — show the raw ID as a fallback rather than an
    // error state so the page is usable even when plan metadata hasn't
    // propagated yet.
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">
                  {data?.planId ?? "Unknown plan"}
                </CardTitle>
                <CardDescription>
                  Plan details are loading. Refresh in a moment.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Plan information for &quot;{data?.planId ?? "this tenant"}&quot; is not
                yet available. Contact support if this persists.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">{plan.displayName}</CardTitle>
              <CardDescription>{plan.tagline}</CardDescription>
            </div>
            <Badge variant="secondary">{plan.id}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {upgrade ? (
            <Button asChild>
              <Link href={upgrade.href}>{upgrade.label} →</Link>
            </Button>
          ) : null}
          {plan.id !== "enterprise-deploy" ? (
            <Button
              variant="outline"
              onClick={openCustomerPortal}
              disabled={portalLoading}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {portalLoading ? "Opening…" : "Manage payment"}
              <ExternalLink className="ml-2 h-3 w-3 opacity-60" />
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact your account team for billing changes.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <QuotaCard
          label="Concurrent missions"
          description="Missions in non-terminal execution at any moment."
          used={data?.currentConcurrentMissions ?? 0}
          limit={data?.concurrentMissions ?? plan.quotas.concurrent_missions}
        />
        <QuotaCard
          label="Concurrent agents"
          description="Agents currently bound to an in-flight mission task."
          used={data?.currentConcurrentAgents ?? 0}
          limit={data?.concurrentAgents ?? plan.quotas.concurrent_agents}
        />
      </div>
    </div>
  );
}
