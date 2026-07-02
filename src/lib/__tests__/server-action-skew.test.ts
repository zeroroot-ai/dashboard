import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isServerActionDeploymentSkew,
  reloadForDeploymentSkew,
} from "../server-action-skew";

describe("isServerActionDeploymentSkew", () => {
  it("detects the Next.js 'Failed to find Server Action' error", () => {
    const err = new Error(
      'Failed to find Server Action "0087484d780b593b968b81dc097e7f94e6623db4fa". This request might be from an older or newer deployment.',
    );
    expect(isServerActionDeploymentSkew(err)).toBe(true);
  });

  it("detects the 'older or newer deployment' phrasing on its own", () => {
    expect(
      isServerActionDeploymentSkew(
        new Error("This request might be from an older or newer deployment."),
      ),
    ).toBe(true);
  });

  it("matches string (non-Error) rejection values", () => {
    expect(
      isServerActionDeploymentSkew("Failed to find Server Action \"abc\""),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isServerActionDeploymentSkew(new Error("network timeout"))).toBe(
      false,
    );
    expect(isServerActionDeploymentSkew(undefined)).toBe(false);
    expect(isServerActionDeploymentSkew(null)).toBe(false);
  });
});

describe("reloadForDeploymentSkew", () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    window.sessionStorage.clear();
    // jsdom's location.reload is non-configurable; stub via defineProperty.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reloads and records a timestamp on first skew", () => {
    expect(reloadForDeploymentSkew()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem("gibson:sa-skew-reloaded-at"),
    ).not.toBeNull();
  });

  it("suppresses a second reload within the loop-guard window", () => {
    expect(reloadForDeploymentSkew()).toBe(true);
    expect(reloadForDeploymentSkew()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the loop-guard window has elapsed", () => {
    // First reload stamps "now"; rewind it past the 15s guard.
    expect(reloadForDeploymentSkew()).toBe(true);
    window.sessionStorage.setItem(
      "gibson:sa-skew-reloaded-at",
      String(Date.now() - 20_000),
    );
    expect(reloadForDeploymentSkew()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
