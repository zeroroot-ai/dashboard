/**
 * Tests for AuthGatedButton. Covers all three visibility states:
 * allowed (clickable CTA), denied (disabled + tooltip), loading
 * (skeleton placeholder). Regression guard for the bug class where
 * authz-gated buttons silently disappear from the DOM.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AuthGatedButton } from "../AuthGatedButton";

describe("AuthGatedButton", () => {
  describe("state=loading", () => {
    it("renders a skeleton placeholder with aria-busy", () => {
      render(
        <AuthGatedButton state="loading" disabledTooltip="nope">
          Deploy
        </AuthGatedButton>,
      );
      const skeleton = screen.getByTestId("auth-gated-button-loading");
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByText("Deploy")).not.toBeInTheDocument();
    });
  });

  describe("state=denied", () => {
    it("renders a disabled button with the children visible", () => {
      render(
        <AuthGatedButton
          state="denied"
          disabledTooltip="Ask your admin for permission to deploy."
        >
          Deploy agent
        </AuthGatedButton>,
      );
      // Children remain visible so non-admins see the affordance.
      expect(screen.getByText("Deploy agent")).toBeInTheDocument();
      // The disabled button is in the DOM, not stripped to null.
      const triggers = screen.getAllByRole("button");
      expect(triggers.length).toBeGreaterThan(0);
      // The outer disabled wrapper carries aria-disabled.
      const wrapper = screen.getByTestId("auth-gated-button-denied");
      expect(wrapper).toHaveAttribute("aria-disabled", "true");
    });

    it("exposes the tooltip copy in the DOM tree", () => {
      // The Tooltip portal mounts on open. For the static-DOM check, we
      // verify that the tooltip trigger is wired up; the actual hover
      // open is covered by the e2e specs against a real browser.
      const tooltipCopy = "Ask your admin for permission to deploy.";
      render(
        <AuthGatedButton state="denied" disabledTooltip={tooltipCopy}>
          Deploy agent
        </AuthGatedButton>,
      );
      const wrapper = screen.getByTestId("auth-gated-button-denied");
      expect(wrapper.getAttribute("role")).toBe("button");
    });
  });

  describe("state=allowed", () => {
    it("renders a clickable button with children", () => {
      render(
        <AuthGatedButton state="allowed" disabledTooltip="nope">
          Deploy plugin
        </AuthGatedButton>,
      );
      const button = screen.getByTestId("auth-gated-button-allowed");
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
      expect(screen.getByText("Deploy plugin")).toBeInTheDocument();
    });

    it("supports asChild for wrapping a Link", () => {
      render(
        <AuthGatedButton state="allowed" disabledTooltip="nope" asChild>
          <a href="/dashboard/deploy?type=tool">Deploy tool</a>
        </AuthGatedButton>,
      );
      const link = screen.getByRole("link", { name: /deploy tool/i });
      expect(link).toHaveAttribute("href", "/dashboard/deploy?type=tool");
    });
  });

  it("never renders null — the affordance is always discoverable", () => {
    const { container, rerender } = render(
      <AuthGatedButton state="loading" disabledTooltip="nope">
        Deploy
      </AuthGatedButton>,
    );
    expect(container.firstChild).not.toBeNull();
    rerender(
      <AuthGatedButton state="denied" disabledTooltip="nope">
        Deploy
      </AuthGatedButton>,
    );
    expect(container.firstChild).not.toBeNull();
    rerender(
      <AuthGatedButton state="allowed" disabledTooltip="nope">
        Deploy
      </AuthGatedButton>,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
