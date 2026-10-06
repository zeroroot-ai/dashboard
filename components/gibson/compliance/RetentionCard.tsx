// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The retention period of the tenant (gibson#676, gibson#992). Postgres
 * keeps the audit log and the Timeline history for the period. After it,
 * only the durable bucket holds them. An Owner or an Admin can set a longer
 * period than the period of the installation, never a shorter one.
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getRetentionAction, setRetentionAction } from "@/app/actions/retention";
import { RETENTION_TEXT, retentionSummary } from "./retention-texts";

export function RetentionCard() {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["retention"],
    queryFn: async () => {
      const res = await getRetentionAction();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });
  const [months, setMonths] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const value = Number(months);
  const minimum = data?.installMonths ?? 13;
  const valid = months !== "" && Number.isInteger(value) && value >= minimum;

  async function save(next: number) {
    setSaving(true);
    try {
      const res = await setRetentionAction({ months: next });
      if (!res.ok) throw new Error(res.error);
      queryClient.setQueryData(["retention"], res.data);
      setMonths("");
      toast.success(RETENTION_TEXT.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : RETENTION_TEXT.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="retention">
      <CardHeader>
        <CardTitle>{RETENTION_TEXT.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{RETENTION_TEXT.intro}</p>
        {isLoading && <p className="text-muted-foreground">{RETENTION_TEXT.loading}</p>}
        {error && (
          <p className="text-destructive">
            {error instanceof Error ? error.message : RETENTION_TEXT.failed}
          </p>
        )}
        {data && (
          <p data-testid="retention-summary">
            {retentionSummary(data.effectiveMonths, data.installMonths, data.tenantMonths)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={minimum}
            step={1}
            className="w-32"
            aria-label={RETENTION_TEXT.inputLabel}
            placeholder={String(minimum)}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
          <Button onClick={() => save(value)} disabled={!valid || saving}>
            {RETENTION_TEXT.save}
          </Button>
          {data && data.tenantMonths > 0 && (
            <Button variant="outline" onClick={() => save(0)} disabled={saving}>
              {RETENTION_TEXT.reset}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
