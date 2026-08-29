import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

import {
  RWXMatrix,
  type RWXItem,
  type RWXMatrixProps,
} from "../RWXMatrix";

function renderMatrix(props: RWXMatrixProps) {
  return render(
    <TooltipProvider>
      <RWXMatrix {...props} />
    </TooltipProvider>,
  );
}

const baseItem: RWXItem = {
  name: "gitlab",
  displayName: "GitLab Plugin",
  description: "v2.1.0, Source control",
  rwx: { read: true, write: false, execute: false },
  denyingGates: ["tenant:acme#tenant_write_disabled@component:plugin/gitlab"],
  killSwitch: { read: false, write: true, execute: false },
  inTenantCatalog: true,
};

describe("RWXMatrix", () => {
  it("renders the item name + description", () => {
    renderMatrix({ items: [baseItem], onToggle: () => {} });
    expect(screen.getByText("GitLab Plugin")).toBeInTheDocument();
    expect(
      screen.getByText(/v2\.1\.0, Source control/),
    ).toBeInTheDocument();
  });

  it("toggle mode emits onToggle with the switch's new value", () => {
    const onToggle = vi.fn();
    renderMatrix({ items: [baseItem], onToggle });
    const readSwitch = screen.getByRole("switch", {
      name: /read for GitLab Plugin/i,
    });
    fireEvent.click(readSwitch);
    expect(onToggle).toHaveBeenCalledTimes(1);
    const [item, action, enabled] = onToggle.mock.calls[0];
    expect(item.name).toBe("gitlab");
    expect(action).toBe("read");
    expect(typeof enabled).toBe("boolean");
  });

  it("approve mode renders checkboxes instead of switches", () => {
    renderMatrix({
      items: [baseItem],
      onToggle: () => {},
      mode: "approve",
    });
    expect(
      screen.queryByRole("switch", { name: /read for GitLab Plugin/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /read for GitLab Plugin/i }),
    ).toBeInTheDocument();
  });

  it("rowTrailingAction renders when provided; absent otherwise", () => {
    const withTrailing = renderMatrix({
      items: [baseItem],
      onToggle: () => {},
      rowTrailingAction: (item) => (
        <span data-testid="trailing">configure {item.name}</span>
      ),
    });
    expect(withTrailing.getByTestId("trailing")).toHaveTextContent(
      "configure gitlab",
    );

    withTrailing.unmount();
    const withoutTrailing = renderMatrix({
      items: [baseItem],
      onToggle: () => {},
    });
    expect(withoutTrailing.queryByTestId("trailing")).toBeNull();
  });

  it("executeAnnotation renders under the execute cell when provided; absent otherwise", () => {
    const withAnnotation = renderMatrix({
      items: [baseItem],
      onToggle: () => {},
      executeAnnotation: (item) =>
        item.name === "gitlab" ? <span>Scope: read_api</span> : null,
    });
    expect(withAnnotation.getByText("Scope: read_api")).toBeInTheDocument();

    withAnnotation.unmount();
    const withoutAnnotation = renderMatrix({
      items: [baseItem],
      onToggle: () => {},
    });
    expect(withoutAnnotation.queryByText(/Scope:/)).toBeNull();
  });

  it("readOnly disables the controls", () => {
    renderMatrix({ items: [baseItem], onToggle: () => {}, readOnly: true });
    const readSwitch = screen.getByRole("switch", {
      name: /read for GitLab Plugin/i,
    });
    // Shadcn's Switch uses data-disabled="" + disabled attribute; either works.
    expect(
      readSwitch.hasAttribute("disabled") ||
        readSwitch.hasAttribute("data-disabled"),
    ).toBe(true);
  });
});

describe("RWXMatrix kill-switch binding (dashboard#1135)", () => {
  it("a toggle switch shows the deny tuple state, not the effective capability", () => {
    // execute: no deny tuple, but effective capability false (not granted).
    // The switch must render ON, because clicking it would write a deny.
    renderMatrix({ items: [baseItem], onToggle: () => {} });
    const exec = screen.getByRole("switch", { name: /execute for GitLab Plugin/i });
    expect(exec).toHaveAttribute("aria-checked", "true");
    const write = screen.getByRole("switch", { name: /write for GitLab Plugin/i });
    expect(write).toHaveAttribute("aria-checked", "false");
  });

  it("an unknown switch state disables the switch instead of guessing", () => {
    renderMatrix({ items: [{ ...baseItem, killSwitch: undefined }], onToggle: () => {} });
    const read = screen.getByRole("switch", { name: /read for GitLab Plugin/i });
    expect(read).toBeDisabled();
    expect(read).toHaveAttribute("aria-checked", "false");
  });

  it("an item outside the tenant catalog offers Enable when onEnable is given", () => {
    const onEnable = vi.fn();
    renderMatrix({
      items: [{ ...baseItem, inTenantCatalog: false }],
      onToggle: () => {},
      onEnable,
    });
    expect(screen.getByText(/Not in tenant catalog/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /enable GitLab Plugin in tenant catalog/i }));
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onEnable.mock.calls[0][0].name).toBe("gitlab");
  });

  it("an item outside the tenant catalog shows no Enable without onEnable", () => {
    renderMatrix({ items: [{ ...baseItem, inTenantCatalog: false }], onToggle: () => {} });
    expect(screen.queryByRole("button", { name: /enable/i })).toBeNull();
  });
});
