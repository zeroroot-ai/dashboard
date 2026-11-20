// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The report of one incident (IncidentReportService.GetIncidentReport,
 * gibson#1480, ADR-0180). The daemon joins the graph and the Timeline. The
 * dashboard maps the reply to JSON and links each line to its replay frame.
 */

import type {
  GetIncidentReportResponse,
  IncidentAction,
  ReplayFrame,
} from "@/src/gen/gibson/tenant/v1/incident_report_pb";
import { IncidentAction_Outcome } from "@/src/gen/gibson/tenant/v1/incident_report_pb";
import { safeHttpUrl } from "@/src/lib/findings/open-findings";

/** The Timeline position of a line. `known` is false when the Timeline holds no event for it. */
export interface FrameView {
  known: boolean;
  timelineSeq: number;
  replaySeq: number;
}

export type ActionOutcome = "done" | "refused" | "pending-authorization" | "failed" | "unknown";

export interface IncidentReportView {
  incidentKey: string;
  alerts: { key: string; title: string; source: string; severity: string; frame: FrameView }[];
  reached: { label: string; key: string; alertKey: string; frame: FrameView }[];
  actions: {
    toolId: string;
    connector: string;
    tool: string;
    agentName: string;
    outcome: ActionOutcome;
    error: string;
    result: string;
    controlIds: string[];
    /** Null when the grant is not recorded. A refused call has no grant. */
    grant: { id: string; capability: string; grantedBy: string; grantedAtUnix: number } | null;
    frame: FrameView;
  }[];
  causes: {
    findingKey: string;
    title: string;
    severity: string;
    status: string;
    raised: FrameView;
    history: { status: string; frame: FrameView }[];
  }[];
  fixes: {
    findingKey: string;
    mergeRequestKey: string;
    /** Empty when the key is not an http or https URL. */
    url: string;
    ref: string;
    frame: FrameView;
    verifiedBy: string;
    verified: FrameView;
  }[];
  controlIds: string[];
  timelineTotal: number;
}

const OUTCOMES: Record<number, ActionOutcome> = {
  [IncidentAction_Outcome.DONE]: "done",
  [IncidentAction_Outcome.REFUSED]: "refused",
  [IncidentAction_Outcome.PENDING_AUTHORIZATION]: "pending-authorization",
  [IncidentAction_Outcome.FAILED]: "failed",
};

function frame(f: ReplayFrame | undefined): FrameView {
  return {
    known: f?.known ?? false,
    timelineSeq: Number(f?.timelineSeq ?? 0),
    replaySeq: Number(f?.replaySeq ?? 0),
  };
}

function action(a: IncidentAction): IncidentReportView["actions"][number] {
  return {
    toolId: a.toolId,
    connector: a.connector,
    tool: a.tool,
    agentName: a.agentName,
    outcome: OUTCOMES[a.outcome] ?? "unknown",
    error: a.error,
    result: a.result,
    controlIds: [...a.controlIds],
    grant: a.grant
      ? {
          id: a.grant.id,
          capability: a.grant.capability,
          grantedBy: a.grant.grantedBy,
          grantedAtUnix: Number(a.grant.grantedAtUnix),
        }
      : null,
    frame: frame(a.frame),
  };
}

export function toIncidentReport(r: GetIncidentReportResponse): IncidentReportView {
  return {
    incidentKey: r.incidentKey,
    alerts: r.alerts.map((a) => ({
      key: a.key,
      title: a.title,
      source: a.source,
      severity: a.severity,
      frame: frame(a.frame),
    })),
    reached: r.reached.map((x) => ({ label: x.label, key: x.key, alertKey: x.alertKey, frame: frame(x.frame) })),
    actions: r.actions.map(action),
    causes: r.causes.map((c) => ({
      findingKey: c.findingKey,
      title: c.title,
      severity: c.severity,
      status: c.status,
      raised: frame(c.raised),
      history: c.history.map((h) => ({ status: h.status, frame: frame(h.frame) })),
    })),
    fixes: r.fixes.map((f) => ({
      findingKey: f.findingKey,
      mergeRequestKey: f.mergeRequestKey,
      url: safeHttpUrl(f.url),
      ref: f.ref,
      frame: frame(f.frame),
      verifiedBy: f.verifiedBy,
      verified: frame(f.verified),
    })),
    controlIds: [...r.controlIds],
    timelineTotal: Number(r.timelineTotal),
  };
}

/** The replay frame of a line, or null when the Timeline holds no event for it. */
export function frameHref(f: FrameView): string | null {
  return f.known ? `/dashboard/world?seq=${f.timelineSeq}` : null;
}

/** The page of the report of an incident. */
export function incidentReportHref(incidentKey: string): string {
  return `/dashboard/incidents/${encodeURIComponent(incidentKey)}`;
}
