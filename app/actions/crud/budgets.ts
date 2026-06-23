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
 * Authz: the daemon's ext-authz layer is authoritative and rejects
 * non-admin mutations. As defense-in-depth (mirroring app/actions/secrets.ts),
 * each mutating action ALSO calls assertAuthorized against its own registered
 * RPC at the top of the function, before any daemon call. This short-circuits
 * unauthorized callers with the canonical "Permission denied" result instead
 * of paying a round-trip and surfacing a generic daemon error. The relation
 * each method requires is derived from the generated authz registry (the same
 * source ext-authz enforces); it is never hand-picked here.
 */

import { getBudgetClient } from "@/src/lib/gibson-client";
import { getServerSession } from "@/src/lib/auth";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";
import { BudgetScope } from "@/src/gen/gibson/budget_status/v1/budget_status_pb";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

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
  const session = await getServerSession();
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
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    const resp = await client.listBudgetStatus({ scope: scopeToProto(scope) });
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
// Set (admin-only, daemon enforces; dashboard short-circuits obvious
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
  try {
    await assertAuthorized("/gibson.tenant.v1.BudgetService/SetBudget");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }

  const session = await getServerSession();
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
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    const resp = await client.getTenantBudgetDefaults({});
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
  try {
    await assertAuthorized(
      "/gibson.tenant.v1.BudgetService/SetTenantBudgetDefaults",
    );
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }

  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getBudgetClient();
    await client.setTenantBudgetDefaults({
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
