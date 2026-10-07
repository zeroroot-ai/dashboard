// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The audit log page (lane 11 row G23): each record shows its actor, the
 * kind of actor and the target object, "Load more" reads the next page
 * with the cursor, and an empty log says so.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock("@/app/actions/audit-log", () => ({ listAuditRecordsAction: mockList }));

import { AuditLogContent } from "../AuditLogContent";
import { AUDIT_TEXT } from "../texts";

const RECORD = {
  eventType: "member.role_changed",
  timestamp: "2026-10-01T09:30:00Z",
  actorId: "user-123",
  actorEmail: "owner@example.test",
  actorSource: "user",
  targetObject: "member:user-456",
  traceId: "t1",
};

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditLogContent />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockList.mockReset();
});

describe("AuditLogContent", () => {
  it("shows the actor, the kind of actor and the target of each record", async () => {
    mockList.mockResolvedValue({ ok: true, data: { records: [RECORD], nextCursor: "" } });
    wrap();
    const row = await screen.findByTestId("audit-row");
    expect(within(row).getByText("owner@example.test")).toBeTruthy();
    expect(within(row).getByText("user-123")).toBeTruthy();
    expect(within(row).getByText("User")).toBeTruthy();
    expect(within(row).getByText("member:user-456")).toBeTruthy();
    expect(screen.queryByRole("button", { name: AUDIT_TEXT.loadMore })).toBeNull();
  });

  it("reads the next page with the cursor", async () => {
    mockList
      .mockResolvedValueOnce({ ok: true, data: { records: [RECORD], nextCursor: "c2" } })
      .mockResolvedValueOnce({
        ok: true,
        data: { records: [{ ...RECORD, actorSource: "agent", actorEmail: "" }], nextCursor: "" },
      });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: AUDIT_TEXT.loadMore }));
    await waitFor(() => expect(screen.getAllByTestId("audit-row")).toHaveLength(2));
    expect(mockList).toHaveBeenNthCalledWith(1, "");
    expect(mockList).toHaveBeenNthCalledWith(2, "c2");
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("states that the log holds no record", async () => {
    mockList.mockResolvedValue({ ok: true, data: { records: [], nextCursor: "" } });
    wrap();
    expect(await screen.findByTestId("audit-empty")).toHaveTextContent(AUDIT_TEXT.empty);
  });
});
