"use client";

/**
 * BudgetsContent — admin-only UI for managing per-user and per-team
 * LLM budgets plus the tenant-level defaults.
 *
 * Spec: llm-user-attribution-governance (Requirement 3).
 */

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  getTenantBudgetDefaultsAction,
  setTenantBudgetDefaultsAction,
  listBudgetStatusAction,
  setBudgetAction,
  type BudgetStatusRow,
  type ScopeInput,
  type TenantDefaultsRow,
} from "@/app/actions/crud/budgets";

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BudgetsContent() {
  const [defaults, setDefaults] = useState<TenantDefaultsRow | null>(null);
  const [userRows, setUserRows] = useState<BudgetStatusRow[]>([]);
  const [teamRows, setTeamRows] = useState<BudgetStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const [d, u, t] = await Promise.all([
      getTenantBudgetDefaultsAction(),
      listBudgetStatusAction("user"),
      listBudgetStatusAction("team"),
    ]);
    if (d.ok) setDefaults(d.data);
    if (u.ok) setUserRows(u.data);
    if (t.ok) setTeamRows(t.data);
    const firstErr = [d, u, t].find((r) => !r.ok);
    if (firstErr && !firstErr.ok) setError(firstErr.error);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <TenantDefaultsCard defaults={defaults} onSaved={refresh} />
      <BudgetTableCard
        title="Per-user budgets"
        description="Overrides the tenant default for individual users. Set MonthlyTokens=0 for unlimited."
        scope="user"
        rows={userRows}
        loading={loading}
        error={error}
        onSaved={refresh}
      />
      <BudgetTableCard
        title="Per-team budgets"
        description="Team-wide ceilings evaluated in addition to user budgets. A call is denied if either limit is exceeded."
        scope="team"
        rows={teamRows}
        loading={loading}
        error={error}
        onSaved={refresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Tenant defaults card
// ---------------------------------------------------------------------

function TenantDefaultsCard({
  defaults,
  onSaved,
}: {
  defaults: TenantDefaultsRow | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TenantDefaultsRow>({
    defaultUserMonthlyTokens: 0,
    defaultUserMonthlySpendUsdCents: 0,
    defaultTeamMonthlyTokens: 0,
    defaultTeamMonthlySpendUsdCents: 0,
    defaultWarningThreshold: 0.8,
  });

  useEffect(() => {
    if (defaults) setForm(defaults);
  }, [defaults]);

  async function save() {
    const res = await setTenantBudgetDefaultsAction(form);
    if (res.ok) {
      toast.success("Tenant defaults saved");
      onSaved();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tenant defaults</CardTitle>
        <CardDescription>
          Fallback values applied to any user or team without an explicit
          budget. 0 = unlimited on that dimension.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
          <NumberField
            label="Default user tokens / month"
            value={form.defaultUserMonthlyTokens}
            onChange={(v) =>
              setForm((f) => ({ ...f, defaultUserMonthlyTokens: v }))
            }
          />
          <NumberField
            label="Default user spend (USD cents) / month"
            value={form.defaultUserMonthlySpendUsdCents}
            onChange={(v) =>
              setForm((f) => ({ ...f, defaultUserMonthlySpendUsdCents: v }))
            }
          />
          <NumberField
            label="Default team tokens / month"
            value={form.defaultTeamMonthlyTokens}
            onChange={(v) =>
              setForm((f) => ({ ...f, defaultTeamMonthlyTokens: v }))
            }
          />
          <NumberField
            label="Default team spend (USD cents) / month"
            value={form.defaultTeamMonthlySpendUsdCents}
            onChange={(v) =>
              setForm((f) => ({ ...f, defaultTeamMonthlySpendUsdCents: v }))
            }
          />
          <NumberField
            label="Warning threshold (0.0–1.0)"
            step="0.05"
            value={form.defaultWarningThreshold}
            onChange={(v) =>
              setForm((f) => ({ ...f, defaultWarningThreshold: v }))
            }
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save}>Save defaults</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Budget table card (user or team)
// ---------------------------------------------------------------------

function BudgetTableCard({
  title,
  description,
  scope,
  rows,
  loading,
  error,
  onSaved,
}: {
  title: string;
  description: string;
  scope: ScopeInput;
  rows: BudgetStatusRow[];
  loading: boolean;
  error: string | null;
  onSaved: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-2 text-sm text-destructive">Error: {error}</p>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {scope} budgets configured. Tenant defaults apply.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Tokens (current / limit)</TableHead>
                <TableHead className="text-right">Spend (current / limit)</TableHead>
                <TableHead>Period resets</TableHead>
                <TableHead>Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.subjectId}>
                  <TableCell className="font-mono text-xs">
                    {r.subjectId}
                  </TableCell>
                  <TableCell className="text-right">
                    <TokenBar
                      current={r.currentTokens}
                      limit={r.tokenLimit}
                      warn={r.warningCrossed}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDollars(r.currentSpendUsdCents)} /{" "}
                    {r.spendLimitUsdCents === 0
                      ? "—"
                      : formatDollars(r.spendLimitUsdCents)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.periodResetAtUnix * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <BudgetEditor scope={scope} row={r} onSaved={onSaved} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TokenBar({
  current,
  limit,
  warn,
}: {
  current: number;
  limit: number;
  warn: boolean;
}) {
  if (limit === 0) return <span className="text-sm">{formatTokens(current)} / ∞</span>;
  const pct = Math.min(100, (current / limit) * 100);
  return (
    <div className="inline-flex flex-col items-end gap-1 min-w-[12rem]">
      <span className={warn ? "text-amber-600 dark:text-amber-400" : ""}>
        {formatTokens(current)} / {formatTokens(limit)}
      </span>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function BudgetEditor({
  scope,
  row,
  onSaved,
}: {
  scope: ScopeInput;
  row: BudgetStatusRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState(row.tokenLimit);
  const [spend, setSpend] = useState(row.spendLimitUsdCents);
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        className="w-28"
        value={tokens}
        onChange={(e) => setTokens(Number(e.target.value))}
        placeholder="Tokens"
      />
      <Input
        type="number"
        className="w-28"
        value={spend}
        onChange={(e) => setSpend(Number(e.target.value))}
        placeholder="Spend ¢"
      />
      <Button
        size="sm"
        onClick={async () => {
          const res = await setBudgetAction({
            scope,
            subjectId: row.subjectId,
            monthlyTokens: tokens,
            monthlySpendUsdCents: spend,
          });
          if (res.ok) {
            toast.success("Budget saved");
            setOpen(false);
            onSaved();
          } else {
            toast.error(res.error);
          }
        }}
      >
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step ?? "1"}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
