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
