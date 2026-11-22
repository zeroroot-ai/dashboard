// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The findings that are not verified, as WorldService.ListOpenFindings returns
 * them (gibson#1498). The daemon gives the rank order. Nothing here sorts.
 */

import type { OpenFindingView } from "@/src/gen/gibson/world/v1/world_pb";
import type { FindingSeverity } from "@/src/types";
import {
  parseFindingPriority,
  parseFindingStatus,
  type FindingPlace,
  type FindingPriority,
  type FindingStatus,
} from "./status";

export interface OpenFinding {
  id: string;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus | undefined;
  priority: FindingPriority | undefined;
  priorityRule: string;
  /** From 0 to 1. Undefined when the store holds no record (the daemon sends 0). */
  confidence: number | undefined;
  /** The URL of the merge request. Empty when the finding has no fix or the key is not a URL. */
  mergeRequestUrl: string;
  mergeRequest: string;
  places: FindingPlace[];
  address: string;
}

const SEVERITIES: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

function parseSeverity(value: string): FindingSeverity {
  const lower = value.toLowerCase();
  return SEVERITIES.find((s) => s === lower) ?? "info";
}

/** A link target that the browser may follow. Anything but http and https is dropped. */
export function safeHttpUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : "";
}

/** Make the JSON form of one open finding. The daemon sends confidence 0 for "no record". */
export function toOpenFinding(v: OpenFindingView): OpenFinding {
  return {
    id: v.id,
    title: v.title,
    severity: parseSeverity(v.severity),
    status: parseFindingStatus(v.status),
    priority: parseFindingPriority(v.priority),
    priorityRule: v.priorityRule,
    confidence: v.confidence > 0 ? v.confidence : undefined,
    mergeRequestUrl: safeHttpUrl(v.mergeRequestUrl),
    mergeRequest: v.mergeRequest,
    places: v.places.map((p) => ({ label: p.label, key: p.key })),
    address: v.address,
  };
}
