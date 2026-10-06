// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The compliance evidence page (dashboard#224, D56): a control with events,
 * a control with a rule and no events, a control with no rule, a tenant
 * with no pack, the approved texts byte for byte, no verdict word, and the
 * two exports.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockEvidence } = vi.hoisted(() => ({ mockEvidence: vi.fn() }));
vi.mock("@/app/actions/compliance", () => ({
  getComplianceEvidenceAction: mockEvidence,
}));

import { ComplianceEvidenceContent } from "../ComplianceEvidenceContent";
import { COMPLIANCE_TEXT, DEFAULT_RANGE_DAYS, coverageText } from "../texts";
import { toCsv, toJson } from "../export";

/** The approved texts of D56, copied from the decision byte for byte. */
const APPROVED = {
  title: "Compliance evidence",
  intro:
    "This page shows events from your audit log that are evidence for a control. It does not state that you meet a control. An assessor makes that decision.",
  coverage: "{n} of {m} controls have an automated rule.",
  noRule: "No automated evidence",
  noEvents: "No events in this period",
  noPack:
    "No compliance pack is enabled for this organization. An Owner or an Admin can enable one in Settings.",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
};

const REPORT = {
  pack: "nist-800-53-r5",
  packVersion: 1,
  controlsWithRule: 2,
  controlsTotal: 3,
  controls: [
    {
      controlId: "AC-2",
      title: "Account Management",
      family: "AC",
      familyTitle: "Access Control",
      state: "has_evidence" as const,
      eventCount: 2,
      lastEventTime: "2026-10-01T12:00:00.000Z",
    },
    {
      controlId: "AC-7",
      title: "Unsuccessful Logon Attempts",
      family: "AC",
      familyTitle: "Access Control",
      state: "no_events" as const,
      eventCount: 0,
      lastEventTime: "",
    },
    {
      controlId: "PE-3",
      title: "Physical Access Control",
      family: "PE",
      familyTitle: "Physical and Environmental Protection",
      state: "no_rule" as const,
      eventCount: 0,
      lastEventTime: "",
    },
  ],
  events: [
    {
      auditRecordId: "rec-1",
      time: "2026-09-30T12:00:00.000Z",
      action: "membership.added",
      actorId: "u-1",
      resourceType: "member",
      resourceId: "m-1",
      controlIds: ["AC-2"],
    },
    {
      auditRecordId: "rec-2",
      time: "2026-10-01T12:00:00.000Z",
      action: "membership.removed",
      actorId: "u-1",
      resourceType: "member",
      resourceId: "m-2",
      controlIds: ["AC-2"],
    },
  ],
};

function renderPage(packs: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComplianceEvidenceContent packs={packs} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockEvidence.mockReset().mockResolvedValue({ ok: true, data: REPORT });
});

describe("approved texts", () => {
  it("are the texts of D56, byte for byte", () => {
    expect(COMPLIANCE_TEXT.title).toBe(APPROVED.title);
    expect(COMPLIANCE_TEXT.intro).toBe(APPROVED.intro);
    expect(coverageText(7, 9)).toBe(
      APPROVED.coverage.replace("{n}", "7").replace("{m}", "9"),
    );
    expect(COMPLIANCE_TEXT.noRule).toBe(APPROVED.noRule);
    expect(COMPLIANCE_TEXT.noEvents).toBe(APPROVED.noEvents);
    expect(COMPLIANCE_TEXT.noPack).toBe(APPROVED.noPack);
    expect(COMPLIANCE_TEXT.exportCsv).toBe(APPROVED.exportCsv);
    expect(COMPLIANCE_TEXT.exportJson).toBe(APPROVED.exportJson);
  });
});

describe("ComplianceEvidenceContent", () => {
  it("states that no pack is enabled, and asks for no evidence", () => {
    renderPage([]);
    expect(screen.getByText(APPROVED.title)).toBeInTheDocument();
    expect(screen.getByText(APPROVED.intro)).toBeInTheDocument();
    expect(screen.getByTestId("compliance-no-pack")).toHaveTextContent(APPROVED.noPack);
    expect(mockEvidence).not.toHaveBeenCalled();
  });

  it("asks for the first pack and a default range of 90 days", async () => {
    renderPage(["nist-800-53-r5"]);
    await screen.findByTestId("compliance-coverage");
    const { pack, start, end } = mockEvidence.mock.calls[0][0];
    expect(pack).toBe("nist-800-53-r5");
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
    expect(days).toBe(DEFAULT_RANGE_DAYS + 1);
  });

  it("shows each state of a control, grouped by family", async () => {
    renderPage(["nist-800-53-r5"]);
    expect(await screen.findByTestId("compliance-coverage")).toHaveTextContent(
      "2 of 3 controls have an automated rule.",
    );
    const families = screen.getAllByTestId("compliance-family");
    expect(families).toHaveLength(2);
    expect(within(families[0]).getByText("Access Control")).toBeInTheDocument();

    const rows = screen.getAllByTestId("compliance-control");
    const byState = (s: string) => rows.find((r) => r.getAttribute("data-state") === s)!;
    expect(byState("has_evidence")).toHaveTextContent("AC-2");
    expect(byState("has_evidence")).toHaveTextContent("2 ·");
    expect(byState("no_events")).toHaveTextContent(APPROVED.noEvents);
    expect(byState("no_rule")).toHaveTextContent(APPROVED.noRule);
  });

  it("opens the events of a row, and each event links to its audit record", async () => {
    const user = userEvent.setup();
    renderPage(["nist-800-53-r5"]);
    await screen.findByTestId("compliance-coverage");
    await user.click(screen.getByText("Account Management"));
    const events = screen.getAllByTestId("compliance-event");
    expect(events).toHaveLength(2);
    expect(within(events[0]).getByRole("link", { name: "rec-1" })).toHaveAttribute(
      "href",
      "#audit-record-rec-1",
    );
  });

  it("states no verdict, no percentage and no score", async () => {
    const { container } = renderPage(["nist-800-53-r5"]);
    await screen.findByTestId("compliance-coverage");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/compliant|passed|failed|non-compliant|score|%/i);
    expect(screen.getByRole("button", { name: APPROVED.exportCsv })).toBeEnabled();
    expect(screen.getByRole("button", { name: APPROVED.exportJson })).toBeEnabled();
  });
});

describe("exports", () => {
  it("writes one CSV line for each event, and one for a control with none", () => {
    const lines = toCsv(REPORT).trim().split("\n");
    expect(lines[0]).toBe(
      "family,control_id,title,state,event_count,last_event_time,audit_record_id,event_time,action,actor_id,resource_type,resource_id",
    );
    expect(lines).toHaveLength(1 + 2 + 1 + 1);
    expect(lines[1]).toContain("AC-2");
    expect(lines[1]).toContain("rec-1");
  });

  it("writes the controls with their events as JSON", () => {
    const out = JSON.parse(toJson(REPORT, { start: "a", end: "b" }));
    expect(out.controls[0].events.map((e: { auditRecordId: string }) => e.auditRecordId)).toEqual([
      "rec-1",
      "rec-2",
    ]);
    expect(out.controls[2].events).toEqual([]);
    expect(out).not.toHaveProperty("score");
  });
});
