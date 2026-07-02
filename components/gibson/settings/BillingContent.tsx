"use client";

/**
 * BillingContent, Settings → Billing page.
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

/**
 * @param billingEnabled - whether the dashboard is wired to a Stripe-backed
 *   billing backend (hosted). Passed from the server `BillingPage` boundary
 *   (single source of truth: src/lib/billing/billing-enabled.ts). When false
 *   (on-prem default) the purchase/manage surfaces — upgrade CTA + customer
 *   portal button — are suppressed; plan + quota cards always render.
 */
export function BillingContent({
  billingEnabled = false,
}: {
  billingEnabled?: boolean;
}) {
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

  // Upgrade is a purchase action — only offer it when billing is wired.
  const upgrade = billingEnabled ? getUpgradeTarget(plan?.id) : null;

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
    const planLabel = data?.planId || "No plan assigned";
    const planMsg = data?.planId
      ? `Plan "${data.planId}" is not recognised. Contact support if this persists.`
      : "No plan has been assigned to this tenant yet. Contact support.";
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{planLabel}</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{planMsg}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
        {data ? (
          <div className="grid gap-4 md:grid-cols-2">
            <QuotaCard
              label="Concurrent missions"
              description="Missions in non-terminal execution at any moment."
              used={data.currentConcurrentMissions}
              limit={data.concurrentMissions}
            />
            <QuotaCard
              label="Concurrent agents"
              description="Agents currently bound to an in-flight mission task."
              used={data.currentConcurrentAgents}
              limit={data.concurrentAgents}
            />
          </div>
        ) : null}
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
          {!billingEnabled ? (
            // On-prem / self-host: no Stripe-backed billing backend. Plan +
            // quotas above are config-driven (Entitlements default); there is
            // no self-serve payment to manage.
            <p className="text-sm text-muted-foreground">
              Plan and quotas are managed by your administrator.
            </p>
          ) : plan.id !== "enterprise-deploy" ? (
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
