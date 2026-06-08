/**
 * SessionsTable — render + revoke-flow tests (PRD dashboard#738, S3/S4).
 * Covers loading→populated (with "This device"), empty, error, and the
 * confirm→revoke→refetch flow. The server actions are mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { MySession } from "@/app/actions/sessions/mySessions";

const mockList = vi.fn();
const mockRevoke = vi.fn();
vi.mock("@/app/actions/sessions/mySessions", () => ({
  listMySessionsAction: () => mockList(),
  revokeMySessionAction: (id: string) => mockRevoke(id),
}));

import { SessionsTable } from "@/components/gibson/settings/SessionsTable";

function session(over: Partial<MySession>): MySession {
  return {
    id: "s1",
    ip: "203.0.113.7",
    browser: "Chrome on macOS",
    createdAt: "2026-06-01T10:00:00.000Z",
    lastActiveAt: "2026-06-08T09:30:00.000Z",
    isCurrent: false,
    ...over,
  };
}

beforeEach(() => {
  mockList.mockReset();
  mockRevoke.mockReset();
});

describe("SessionsTable", () => {
  it("renders sessions and marks the current one", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        session({ id: "s1", browser: "Chrome on macOS", isCurrent: true }),
        session({ id: "s2", browser: "Firefox", ip: "198.51.100.4" }),
      ],
    });
    render(<SessionsTable />);

    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("Firefox")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
  });

  it("shows an empty state when there are no sessions", async () => {
    mockList.mockResolvedValue({ ok: true, data: [] });
    render(<SessionsTable />);
    expect(await screen.findByText("No active sessions.")).toBeInTheDocument();
  });

  it("shows an error state when the action fails", async () => {
    mockList.mockResolvedValue({ ok: false, error: "daemon unavailable" });
    render(<SessionsTable />);
    expect(await screen.findByText("daemon unavailable")).toBeInTheDocument();
  });

  it("revokes a session after confirmation and refetches", async () => {
    mockList
      .mockResolvedValueOnce({ ok: true, data: [session({ id: "s2", browser: "Firefox" })] })
      .mockResolvedValueOnce({ ok: true, data: [] });
    mockRevoke.mockResolvedValue({ ok: true, data: null });

    render(<SessionsTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    // Confirm dialog → click the confirm action.
    fireEvent.click(await screen.findByRole("button", { name: "Revoke session" }));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("s2"));
    expect(await screen.findByText("No active sessions.")).toBeInTheDocument();
  });
});
