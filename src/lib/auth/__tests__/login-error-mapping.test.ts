/**
 * Unit tests for the `MembershipResolutionReason` → `LoginErrorReason`
 * mapper used by middleware.ts to populate `/login/error?reason=...`.
 *
 * Regression for dashboard#45: the mapper MUST send `permission_denied`
 * to a distinct page from `daemon_unavailable`, and MUST route
 * `unauthenticated` to `session_invalid` (so the existing "sign in again"
 * copy is reused without paging on-call).
 */

import { describe, it, expect } from "vitest";

import { membershipReasonToLoginErrorReason } from "../login-error-mapping";
import { safeReason } from "../error-codes";

describe("membershipReasonToLoginErrorReason", () => {
  it("permission_denied → permission_denied (NOT daemon_unavailable)", () => {
    expect(membershipReasonToLoginErrorReason("permission_denied")).toBe(
      "permission_denied",
    );
    expect(membershipReasonToLoginErrorReason("permission_denied")).not.toBe(
      "daemon_unavailable",
    );
  });

  it("unauthenticated → session_invalid (no on-call paging, sign-in CTA)", () => {
    expect(membershipReasonToLoginErrorReason("unauthenticated")).toBe(
      "session_invalid",
    );
  });

  it("daemon_unavailable → daemon_unavailable (preserved; this branch is correct)", () => {
    expect(membershipReasonToLoginErrorReason("daemon_unavailable")).toBe(
      "daemon_unavailable",
    );
  });

  it("fga_unavailable → fga_unavailable (preserved)", () => {
    expect(membershipReasonToLoginErrorReason("fga_unavailable")).toBe(
      "fga_unavailable",
    );
  });

  it("malformed_response → unknown (NOT daemon_unavailable; the daemon did respond)", () => {
    expect(membershipReasonToLoginErrorReason("malformed_response")).toBe(
      "unknown",
    );
  });

  it("unknown ConnectRPC code → unknown (NOT daemon_unavailable)", () => {
    expect(membershipReasonToLoginErrorReason("unknown")).toBe("unknown");
  });
});

describe("safeReason allowlist", () => {
  it("permission_denied is allow-listed (does NOT collapse to unknown)", () => {
    expect(safeReason("permission_denied")).toBe("permission_denied");
  });

  it("session_invalid is allow-listed", () => {
    expect(safeReason("session_invalid")).toBe("session_invalid");
  });

  it("daemon_unavailable is allow-listed", () => {
    expect(safeReason("daemon_unavailable")).toBe("daemon_unavailable");
  });

  it("an arbitrary attacker-controlled string collapses to unknown", () => {
    expect(safeReason("<script>alert(1)</script>")).toBe("unknown");
    expect(safeReason("any_unmapped_value")).toBe("unknown");
  });
});
