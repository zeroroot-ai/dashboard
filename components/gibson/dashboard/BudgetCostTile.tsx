// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The cost tile of the first screen (dashboard#394). It shows the budget burn
 * of the organization: the spend, the limit, the reset date and a warning when
 * the budget crosses its limit. It also shows the median model cost for each
 * verified fix.
 *
 * The cost for each verified fix needs a model cost for each finding. The
 * backend returns a cost only for a user, a team, an agent or a mission
 * (UsageService), so no source feeds the `fixCosts` prop. While the prop is
 * absent the tile shows "unknown", says why and shows how many findings were
 * verified in the last 7 days (GetExposureTrend). It never shows zero. A
 * mission cost is not the cost of one fix, so the tile does not derive one.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { WalletIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useExposure } from "@/src/hooks/useExposure";
import { listBudgetStatusAction } from "@/app/actions/crud/budgets";
import {
  formatUsd,
  medianFixCost,
  summarizeBudget,
  type FixCost,
} from "@/src/lib/cost/budget-burn";
import { COST_TEXT } from "./texts";

export function BudgetCostTile({ fixCosts }: { fixCosts?: readonly FixCost[] }) {
  const budget = useQuery({
    queryKey: ["budget-status", "tenant"],
    queryFn: () => listBudgetStatusAction("tenant"),
    staleTime: 60_000,
  });

  const exposure = useExposure();
  const verifiedCount = exposure.data?.exposure.count ?? 0;
  const median = fixCosts === undefined ? null : medianFixCost(fixCosts);

  let budgetBody: React.ReactNode;
  if (budget.isLoading) {
    budgetBody = <Skeleton className="h-12 w-full" />;
  } else if (!budget.data?.ok) {
    budgetBody = (
      <p className="text-sm text-muted-foreground" data-testid="budget-error">
        {COST_TEXT.budgetFailed}
      </p>
    );
  } else if (budget.data.data.length === 0) {
    budgetBody = (
      <p className="text-sm text-muted-foreground" data-testid="budget-none">
        {COST_TEXT.noBudget}
      </p>
    );
  } else {
    const burn = summarizeBudget(budget.data.data[0]);
    budgetBody = (
      <div className="space-y-2 text-sm">
        <p className="text-base font-semibold" data-testid="budget-spent">
          {COST_TEXT.budgetSpent(
            formatUsd(burn.spentUsdCents),
            burn.limitUsdCents === null ? null : formatUsd(burn.limitUsdCents),
          )}
        </p>
        {burn.fraction !== null && (
          <Progress value={burn.fraction * 100} className="h-1.5" aria-label={COST_TEXT.title} />
        )}
        {burn.resetAtMs !== null && (
          <p className="text-xs text-muted-foreground" data-testid="budget-reset">
            {COST_TEXT.resets(new Date(burn.resetAtMs).toLocaleDateString())}
          </p>
        )}
        {burn.limitReached ? (
          <p role="alert" className="text-xs font-medium text-destructive" data-testid="budget-warning">
            {COST_TEXT.limitReached}
          </p>
        ) : burn.warningCrossed ? (
          <p role="alert" className="text-xs font-medium text-alt" data-testid="budget-warning">
            {COST_TEXT.warning}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="glass-hack border-highlight/40" data-testid="tile-cost">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            {COST_TEXT.title}
          </CardTitle>
          <WalletIcon className="h-4 w-4 text-highlight opacity-70" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {budgetBody}
        <div className="space-y-1 border-t border-border pt-3 text-sm" data-testid="fix-cost">
          <p className="text-xs text-muted-foreground">{COST_TEXT.perFix}</p>
          <p className="text-base font-semibold" data-testid="fix-cost-value">
            {median !== null && median.known
              ? formatUsd(median.medianUsdCents)
              : COST_TEXT.unknown}
          </p>
          {median === null && (
            <p className="text-xs text-muted-foreground" data-testid="fix-cost-note">
              {COST_TEXT.perFixNotAvailable}
            </p>
          )}
          {median === null && verifiedCount > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="fix-cost-verified">
              {COST_TEXT.verifiedWithoutCost(verifiedCount)}
            </p>
          )}
          {median !== null && median.known && median.unknownCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {COST_TEXT.perFixUnknownCount(median.unknownCount)}
            </p>
          )}
        </div>
        <Link
          href="/dashboard/pages/settings/budgets"
          className="text-xs underline underline-offset-2 hover:text-highlight"
        >
          {COST_TEXT.open}
        </Link>
      </CardContent>
    </Card>
  );
}
