"use server";

/**
 * Server Actions for the /settings/budgets page.
 *
 * Wraps the daemon's gibson.budget.v1.BudgetService RPCs so the
 * dashboard can list and edit per-user / per-team / per-tenant budgets
 * and tenant-level defaults.
 *
 * Spec: llm-user-attribution-governance (Requirement 3, 5).
 *
 * Admin-only mutations are enforced server-side by the daemon (returns
 * PermissionDenied on non-admin callers); the dashboard still checks
 * the session's admin flag first so we don't round-trip for obvious
 * deny cases.
 */

import { getBudgetClient } from "@/src/lib/gibson-client";
import { getSession } from "@/src/lib/auth";
import { BudgetScope } from "@/src/gen/gibson/budget/v1/budget_pb";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ScopeInput = "user" | "team" | "tenant";

export interface BudgetRow {
  tenantId: string;
  scope: ScopeInput;
  subjectId: string;
  monthlyTokens: number;
  monthlySpendUsdCents: number;
  overrideDeny: boolean;
  warningThreshold: number;
}

export interface BudgetStatusRow {
  scope: ScopeInput;
  subjectId: string;
  currentTokens: number;
  currentSpendUsdCents: number;
  tokenLimit: number;
  spendLimitUsdCents: number;
  periodResetAtUnix: number;
  warningCrossed: boolean;
}

function scopeToProto(s: ScopeInput): BudgetScope {
  switch (s) {
    case "user":
      return BudgetScope.USER;
    case "team":
      return BudgetScope.TEAM;
    case "tenant":
      return BudgetScope.TENANT;
  }
}

function scopeFromProto(s: BudgetScope): ScopeInput {
  switch (s) {
    case BudgetScope.USER:
      return "user";
    case BudgetScope.TEAM:
      return "team";
    case BudgetScope.TENANT:
      return "tenant";
    default:
      return "user";
  }
}

// ---------------------------------------------------------------------
// List
// ---------------------------------------------------------------------

export async function listBudgetsAction(
  scope: ScopeInput,
): Promise<ActionResult<BudgetRow[]>> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    const resp = await client.listBudgets({ scope: scopeToProto(scope) });
    return {
      ok: true,
      data: resp.budgets.map((b) => ({
        tenantId: b.tenantId,
        scope: scopeFromProto(b.scope),
        subjectId: b.subjectId,
        monthlyTokens: Number(b.monthlyTokens),
        monthlySpendUsdCents: Number(b.monthlySpendUsdCents),
        overrideDeny: b.overrideDeny,
        warningThreshold: b.warningThreshold,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listBudgetStatusAction(
  scope: ScopeInput,
): Promise<ActionResult<BudgetStatusRow[]>> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    const resp = await client.listStatus({ scope: scopeToProto(scope) });
    return {
      ok: true,
      data: resp.status.map((s) => ({
        scope: scopeFromProto(s.scope),
        subjectId: s.subjectId,
        currentTokens: Number(s.currentTokens),
        currentSpendUsdCents: Number(s.currentSpendUsdCents),
        tokenLimit: Number(s.tokenLimit),
        spendLimitUsdCents: Number(s.spendLimitUsdCents),
        periodResetAtUnix: Number(s.periodResetAtUnix),
        warningCrossed: s.warningCrossed,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// Set (admin-only — daemon enforces; dashboard short-circuits obvious
// non-admins for UX)
// ---------------------------------------------------------------------

export interface SetBudgetInput {
  scope: ScopeInput;
  subjectId: string;
  monthlyTokens: number;
  monthlySpendUsdCents: number;
  overrideDeny?: boolean;
  warningThreshold?: number;
}

export async function setBudgetAction(
  input: SetBudgetInput,
): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    await client.setBudget({
      budget: {
        tenantId: "", // daemon overwrites with tenant from ctx
        scope: scopeToProto(input.scope),
        subjectId: input.subjectId,
        monthlyTokens: BigInt(input.monthlyTokens),
        monthlySpendUsdCents: BigInt(input.monthlySpendUsdCents),
        overrideDeny: input.overrideDeny ?? false,
        warningThreshold: input.warningThreshold ?? 0.8,
      },
    });
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// Tenant defaults
// ---------------------------------------------------------------------

export interface TenantDefaultsRow {
  defaultUserMonthlyTokens: number;
  defaultUserMonthlySpendUsdCents: number;
  defaultTeamMonthlyTokens: number;
  defaultTeamMonthlySpendUsdCents: number;
  defaultWarningThreshold: number;
}

export async function getTenantBudgetDefaultsAction(): Promise<
  ActionResult<TenantDefaultsRow>
> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    const resp = await client.getTenantDefaults({});
    return {
      ok: true,
      data: {
        defaultUserMonthlyTokens: Number(resp.defaultUserMonthlyTokens),
        defaultUserMonthlySpendUsdCents: Number(
          resp.defaultUserMonthlySpendUsdCents,
        ),
        defaultTeamMonthlyTokens: Number(resp.defaultTeamMonthlyTokens),
        defaultTeamMonthlySpendUsdCents: Number(
          resp.defaultTeamMonthlySpendUsdCents,
        ),
        defaultWarningThreshold: resp.defaultWarningThreshold,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setTenantBudgetDefaultsAction(
  input: TenantDefaultsRow,
): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    await client.setTenantDefaults({
      defaultUserMonthlyTokens: BigInt(input.defaultUserMonthlyTokens),
      defaultUserMonthlySpendUsdCents: BigInt(
        input.defaultUserMonthlySpendUsdCents,
      ),
      defaultTeamMonthlyTokens: BigInt(input.defaultTeamMonthlyTokens),
      defaultTeamMonthlySpendUsdCents: BigInt(
        input.defaultTeamMonthlySpendUsdCents,
      ),
      defaultWarningThreshold: input.defaultWarningThreshold,
    });
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
