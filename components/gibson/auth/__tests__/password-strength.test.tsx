/**
 * Tests for PasswordStrength component — rule checklist + HIBP breach indicator.
 *
 * Covers:
 *   1. Empty password → no breach UI rendered.
 *   2. Rules failing → no breach UI rendered (HIBP not called).
 *   3. Rules passing + breached:true → red Breached badge shown.
 *   4. Rules passing + breached:false → green Strong + "Not found" caption.
 *   5. Rules passing + action returns ok:false (unknown) → neutral fallback.
 *   6. Debounce: typing quickly doesn't fire multiple action calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PasswordStrength } from "../password-strength";
import type { checkPasswordAction } from "@/app/actions/auth/check-password";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A password that passes all five rules. */
const STRONG_PASSWORD = "Correct#Horse1Battery";

/** A password that is too short and fails several rules. */
const WEAK_PASSWORD = "abc";

type CheckResult = Awaited<ReturnType<typeof checkPasswordAction>>;

function makeAction(result: CheckResult): typeof checkPasswordAction {
  return vi.fn().mockResolvedValue(result);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PasswordStrength", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("HIBP disabled (no onCheckPassword)", () => {
    it("renders only the rule checklist with an empty password", () => {
      render(<PasswordStrength password="" />);

      expect(screen.getByText("At least 12 characters")).toBeDefined();
      expect(screen.getByText("Uppercase letter")).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/Checking for known breaches/i)).toBeNull();
      expect(screen.queryByText(/Breached/i)).toBeNull();
    });

    it("renders only the rule checklist with a strong password and no action", () => {
      render(<PasswordStrength password={STRONG_PASSWORD} />);

      expect(screen.getByText("At least 12 characters")).toBeDefined();
      // No breach indicator because no action was provided.
      expect(screen.queryByText(/Checking for known breaches/i)).toBeNull();
      expect(screen.queryByText(/Breached/i)).toBeNull();
      expect(screen.queryByText(/Not found in public breaches/i)).toBeNull();
    });
  });

  describe("HIBP enabled (onCheckPassword provided)", () => {
    it("does not show breach indicator when password is empty", () => {
      const action = makeAction({ ok: true, breached: false });
      render(
        <PasswordStrength
          password=""
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      expect(screen.queryByText(/Checking for known breaches/i)).toBeNull();
      expect(screen.queryByText(/Breached/i)).toBeNull();
      expect(action).not.toHaveBeenCalled();
    });

    it("does not call action when rules are still failing", async () => {
      const action = makeAction({ ok: true, breached: false });
      render(
        <PasswordStrength
          password={WEAK_PASSWORD}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(action).not.toHaveBeenCalled();
      expect(screen.queryByText(/Checking for known breaches/i)).toBeNull();
    });

    it("shows Breached badge when action returns breached:true", async () => {
      const action = makeAction({ ok: true, breached: true, count: 50000 });
      render(
        <PasswordStrength
          password={STRONG_PASSWORD}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      // Advance past debounce and let the promise resolve.
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Breached")).toBeDefined();
      expect(
        screen.getByText(
          /This password has appeared in a public breach\. Please choose a different one\./i,
        ),
      ).toBeDefined();
    });

    it("shows Strong + 'Not found' caption when action returns breached:false", async () => {
      const action = makeAction({ ok: true, breached: false, count: 0 });
      render(
        <PasswordStrength
          password={STRONG_PASSWORD}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Strong")).toBeDefined();
      expect(screen.getByText(/Not found in public breaches/i)).toBeDefined();
    });

    it("shows neutral fallback when action returns ok:false (unknown)", async () => {
      const action = makeAction({ ok: false, reason: "timeout" });
      render(
        <PasswordStrength
          password={STRONG_PASSWORD}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/Breach check unavailable — you can still submit/i),
      ).toBeDefined();
      // Must not show alert or Breached badge.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("Breached")).toBeNull();
    });
  });

  describe("debounce behaviour", () => {
    it("does not call action multiple times for rapid keystrokes", async () => {
      const action = makeAction({ ok: true, breached: false });
      const { rerender } = render(
        <PasswordStrength
          password={STRONG_PASSWORD}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      // Simulate additional keystrokes within the debounce window.
      rerender(
        <PasswordStrength
          password={STRONG_PASSWORD + "a"}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );
      rerender(
        <PasswordStrength
          password={STRONG_PASSWORD + "ab"}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      // Advance to just before debounce triggers — still nothing called.
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(action).not.toHaveBeenCalled();

      // Advance past the debounce window for the last keystroke.
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Exactly ONE call despite three renders.
      expect(action).toHaveBeenCalledTimes(1);
    });

    it("does not call action within 500ms of a single render", async () => {
      const action = makeAction({ ok: true, breached: false });
      render(
        <PasswordStrength
          password={STRONG_PASSWORD}
          onCheckPassword={action}
          hibpEnabled={true}
        />,
      );

      // Advance to just inside the debounce window.
      await act(async () => {
        vi.advanceTimersByTime(499);
      });

      expect(action).not.toHaveBeenCalled();
    });
  });
});
