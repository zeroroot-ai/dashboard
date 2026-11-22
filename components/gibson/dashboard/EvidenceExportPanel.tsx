// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Panel 5 of the first screen: the evidence export (dashboard#387). It
 * exports the evidence of a time range as CSV or JSON. It uses the compliance
 * reader and the export functions of the Compliance page: one code path for
 * the file.
 *
 * The file holds audit events mapped to controls. It does not hold the
 * verified findings with their proof and their D3FEND countermeasures. The
 * backend does not map them yet (gibson#1486), and the panel says so.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getComplianceEvidenceAction, listCompliancePacksAction } from "@/app/actions/compliance";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { COMPLIANCE_TEXT, DEFAULT_RANGE_DAYS } from "@/components/gibson/compliance/texts";
import { download, toCsv, toJson } from "@/components/gibson/compliance/export";
import { dayString, rangeOf } from "@/components/gibson/compliance/range";
import { EVIDENCE_EXPORT_TEXT } from "./texts";

const COMPLIANCE_METHOD = "/gibson.tenant.v1.ComplianceService/ListComplianceEvidence";

export function EvidenceExportPanel() {
  const { allowed, loading } = useAuthorize(COMPLIANCE_METHOD);
  const packs = useQuery({
    queryKey: ["compliance-packs"],
    queryFn: () => listCompliancePacksAction(),
    enabled: !loading && allowed,
    staleTime: 60_000,
  });
  const packList = packs.data?.ok ? packs.data.data : [];
  const [chosenPack, setChosenPack] = React.useState("");
  const pack = chosenPack || packList[0] || "";
  const [endDay, setEndDay] = React.useState(() => dayString(new Date()));
  const [startDay, setStartDay] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - DEFAULT_RANGE_DAYS);
    return dayString(d);
  });
  const [busy, setBusy] = React.useState<"csv" | "json" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(format: "csv" | "json") {
    setBusy(format);
    setError(null);
    try {
      const range = rangeOf(startDay, endDay);
      const res = await getComplianceEvidenceAction({ pack, ...range });
      if (!res.ok) {
        setError(res.error || EVIDENCE_EXPORT_TEXT.failed);
        return;
      }
      if (format === "csv") {
        download(`${res.data.pack}-evidence.csv`, "text/csv", toCsv(res.data));
      } else {
        download(`${res.data.pack}-evidence.json`, "application/json", toJson(res.data, range));
      }
    } catch {
      setError(EVIDENCE_EXPORT_TEXT.failed);
    } finally {
      setBusy(null);
    }
  }

  let body: React.ReactNode;
  if (loading || (allowed && packs.isLoading)) {
    body = <Skeleton className="h-16 w-full" />;
  } else if (!allowed) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="evidence-not-allowed">
        {EVIDENCE_EXPORT_TEXT.notAllowed}
      </p>
    );
  } else if (packs.data && !packs.data.ok) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="evidence-error">
        {EVIDENCE_EXPORT_TEXT.failed}
      </p>
    );
  } else if (packList.length === 0) {
    body = (
      <p className="text-sm" data-testid="evidence-no-pack">
        {COMPLIANCE_TEXT.noPack}
      </p>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label={EVIDENCE_EXPORT_TEXT.framework}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={pack}
            onChange={(e) => setChosenPack(e.target.value)}
          >
            {packList.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Input
            type="date"
            aria-label={EVIDENCE_EXPORT_TEXT.start}
            className="w-auto"
            value={startDay}
            max={endDay}
            onChange={(e) => e.target.value && setStartDay(e.target.value)}
          />
          <Input
            type="date"
            aria-label={EVIDENCE_EXPORT_TEXT.end}
            className="w-auto"
            value={endDay}
            min={startDay}
            onChange={(e) => e.target.value && setEndDay(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run("csv")}>
            <DownloadIcon />
            {busy === "csv" ? EVIDENCE_EXPORT_TEXT.exporting : EVIDENCE_EXPORT_TEXT.exportCsv}
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run("json")}>
            <DownloadIcon />
            {busy === "json" ? EVIDENCE_EXPORT_TEXT.exporting : EVIDENCE_EXPORT_TEXT.exportJson}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive" data-testid="evidence-export-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <Card className="glass-hack border-highlight/40" data-testid="panel-evidence">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          {EVIDENCE_EXPORT_TEXT.title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{EVIDENCE_EXPORT_TEXT.intro}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {body}
        <p className="text-xs text-muted-foreground" data-testid="evidence-not-yet">
          {EVIDENCE_EXPORT_TEXT.notYet}
        </p>
        {allowed && (
          <Link
            href="/dashboard/compliance"
            className="text-xs underline underline-offset-2 hover:text-highlight"
          >
            {EVIDENCE_EXPORT_TEXT.open}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
