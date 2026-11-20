// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { Badge } from "@/components/ui/badge";
import type { FindingSeverity } from "@/src/types";

const SEVERITY_BADGE_CLASS: Record<FindingSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10/60 text-destructive",
  high: "border-alt/40 bg-alt/10/60 text-alt",
  medium: "border-alt/40 bg-alt/10/60 text-alt",
  low: "border-highlight/40 bg-highlight/10/60 text-highlight",
  info: "border-border bg-muted/60 text-muted-foreground",
};

export const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <Badge
      className={`border font-mono text-xs uppercase tracking-wide ${SEVERITY_BADGE_CLASS[severity]}`}
    >
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}
