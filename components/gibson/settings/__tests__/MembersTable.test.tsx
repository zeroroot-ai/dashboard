import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MembersTable } from "@/components/gibson/settings/MembersTable";
import type { MemberRow } from "@/app/actions/read/listMembers";

function row(over: Partial<MemberRow>): MemberRow {
  return {
    userId: "u",
    displayName: "",
    email: "",
    role: "member",
    joinedAt: "",
    status: "active",
    ...over,
  };
}

describe("MembersTable identity fallback (#605)", () => {
  it("falls back to the session identity for the caller's own blank row", () => {
    render(
      <MembersTable
        members={[row({ userId: "me-id", displayName: "", email: "", role: "admin" })]}
        currentUser={{ id: "me-id", name: "My Name", email: "me@example.com" }}
      />,
    );

    expect(screen.getByText("My Name")).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Profile unavailable")).toBeNull();
  });

  it("renders a 'Profile unavailable' state with the user id for a non-caller blank row", () => {
    render(
      <MembersTable
        members={[row({ userId: "other-id", displayName: "", email: "" })]}
        currentUser={{ id: "me-id", name: "My Name", email: "me@example.com" }}
      />,
    );

    expect(screen.getByText("Profile unavailable")).toBeInTheDocument();
    // The stable user id is surfaced so the row is identifiable, not blank.
    expect(screen.getByText("other-id")).toBeInTheDocument();
  });

  it("renders an enriched row unchanged", () => {
    render(
      <MembersTable
        members={[
          row({ userId: "a", displayName: "Alice Admin", email: "alice@example.com", role: "admin" }),
        ]}
      />,
    );
    expect(screen.getByText("Alice Admin")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Profile unavailable")).toBeNull();
  });
});
