// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The first screen (dashboard#388, epic gibson#1497). It answers five
 * questions of a blue team manager, in this order:
 *
 *   1. Which findings are not verified?
 *   2. How long is the exposure window, and how often do fixes revert?
 *   3. What did the agents do, and who allowed it?
 *   4. What waits on a person?
 *   5. Where is the evidence?
 *
 * Below the five panels, two tiles show the control evidence and the model
 * cost.
 */

import { ActionsPanel } from "./ActionsPanel";
import { ControlCoverageTile } from "./ControlCoverageTile";
import { BudgetCostTile } from "./BudgetCostTile";
import { ExposurePanel } from "./ExposurePanel";
import { EvidenceExportPanel } from "./EvidenceExportPanel";
import { FindingsPanel } from "./FindingsPanel";
import { WaitsPanel } from "./WaitsPanel";
import { DASHBOARD_TEXT } from "./texts";

export function DashboardContent() {
  return (
    <div className="bg-grid-hack min-h-full space-y-6 p-1">
      <h1 className="font-mono text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
        <span className="text-highlight/70">&gt;</span> {DASHBOARD_TEXT.title}
      </h1>

      <FindingsPanel />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExposurePanel />
        <ActionsPanel />
      </div>

      <WaitsPanel />

      <EvidenceExportPanel />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ControlCoverageTile />
        <BudgetCostTile />
      </div>
    </div>
  );
}
