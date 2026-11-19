// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import * as React from "react";
import { Download } from "lucide-react";

import { exportFindingsAction } from "@/app/actions/findings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Finding } from "@/src/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportFormat = "csv" | "json";

interface FindingsExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The currently filtered findings to export. */
  findings: Finding[];
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

const CSV_COLUMNS: { header: string; value: (f: Finding) => string }[] = [
  { header: "ID", value: (f) => f.id },
  { header: "Severity", value: (f) => f.severity },
  { header: "Title", value: (f) => f.title },
  { header: "Type", value: (f) => f.type },
  { header: "Affected Assets", value: (f) => f.affectedAssets.join("; ") },
  { header: "Mission ID", value: (f) => f.missionId },
  { header: "Discovered At", value: (f) => new Date(f.discoveredAt).toISOString() },
  { header: "Description", value: (f) => f.description },
  { header: "Remediation", value: (f) => f.remediation ?? "" },
];

/** Escape a single CSV cell value per RFC 4180. */
function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(findings: Finding[]): string {
  const header = CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(",");
  const rows = findings.map((f) =>
    CSV_COLUMNS.map((c) => escapeCsvCell(c.value(f))).join(","),
  );
  return [header, ...rows].join("\r\n");
}

// ── Download helper ───────────────────────────────────────────────────────────

function triggerDownload(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FindingsExportDialog({
  open,
  onOpenChange,
  findings,
}: FindingsExportDialogProps) {
  const [format, setFormat] = React.useState<ExportFormat>("csv");
  const [includeEvidence, setIncludeEvidence] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The list holds no evidence. An export with evidence asks the daemon, which
  // adds all evidence of each finding (include_evidence).
  async function downloadWithEvidence() {
    setBusy(true);
    setError(null);
    try {
      const res = await exportFindingsAction({
        format: "json",
        findingIds: findings.map((f) => f.id),
        includeEvidence: true,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      triggerDownload(res.data.text, "application/json", res.data.filename || "findings.json");
      onOpenChange(false);
    } catch {
      setError("The export failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleDownload() {
    if (format === "json" && includeEvidence) {
      void downloadWithEvidence();
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    if (format === "csv") {
      const csv = buildCsv(findings);
      triggerDownload(csv, "text/csv;charset=utf-8;", `findings-${timestamp}.csv`);
    } else {
      const json = JSON.stringify(findings, null, 2);
      triggerDownload(json, "application/json", `findings-${timestamp}.json`);
    }

    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-hack sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-glow-green">Export Findings</DialogTitle>
          <DialogDescription>
            Export{" "}
            <span className="text-highlight font-medium">{findings.length}</span>{" "}
            finding{findings.length !== 1 ? "s" : ""} matching the current filters.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={format}
          onValueChange={(v) => setFormat(v as ExportFormat)}
          className="gap-3 pt-1"
        >
          <div className="flex items-center gap-3">
            <RadioGroupItem value="csv" id="export-csv" />
            <Label htmlFor="export-csv" className="cursor-pointer font-normal">
              CSV{" "}
              <span className="text-muted-foreground text-xs">
               , spreadsheet-compatible
              </span>
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <RadioGroupItem value="json" id="export-json" />
            <Label htmlFor="export-json" className="cursor-pointer font-normal">
              JSON{" "}
              <span className="text-muted-foreground text-xs">
               , machine-readable
              </span>
            </Label>
          </div>
        </RadioGroup>

        {format === "json" ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="export-evidence"
              checked={includeEvidence}
              onCheckedChange={(v) => setIncludeEvidence(v === true)}
            />
            <Label htmlFor="export-evidence" className="cursor-pointer font-normal">
              Include evidence
            </Label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" data-testid="export-error" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={findings.length === 0 || busy}>
            <Download />
            Download {format.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
