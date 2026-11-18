// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The evidence of a finding is untrusted data of the target. It shows as plain
 * text, in order, with its type, its tier and the tool call of a recorded item.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EvidenceList } from "../EvidenceList";
import type { EvidenceDTO } from "@/src/lib/gibson-client/finding-types";

const item = (over: Partial<EvidenceDTO> = {}): EvidenceDTO => ({
  title: "",
  kind: "response",
  tier: "recorded",
  toolCallId: "call-7",
  content: "HTTP/1.1 200 OK",
  metadata: {},
  ...over,
});

describe("EvidenceList", () => {
  it("shows every item in the given order with type, tier and the tool call of a recorded item", () => {
    render(
      <EvidenceList
        evidence={[
          item({ title: "one", kind: "request", tier: "recorded", toolCallId: "call-1" }),
          item({ title: "two", kind: "conversation", tier: "typed", toolCallId: "" }),
          item({ title: "three", kind: "network_trace", tier: "recorded", toolCallId: "call-3" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("evidence-item");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => within(r).getByText(/^(one|two|three)$/).textContent)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(within(rows[0]).getByTestId("evidence-kind")).toHaveTextContent("Request");
    expect(within(rows[0]).getByTestId("evidence-tier")).toHaveTextContent("Recorded by Gibson");
    expect(within(rows[0]).getByTestId("evidence-tool-call")).toHaveTextContent("Tool call call-1");
    expect(within(rows[1]).getByTestId("evidence-kind")).toHaveTextContent("Conversation");
    expect(within(rows[1]).getByTestId("evidence-tier")).toHaveTextContent("Typed by the agent");
    expect(within(rows[1]).queryByTestId("evidence-tool-call")).toBeNull();
    expect(within(rows[2]).getByTestId("evidence-kind")).toHaveTextContent("Network trace");
  });

  it("shows a conversation as a dialogue block, keeping the line breaks", () => {
    render(<EvidenceList evidence={[item({ kind: "conversation", content: "user: hi\nmodel: hello" })]} />);
    const pre = screen.getByTestId("evidence-content");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("data-form", "dialogue");
    expect(pre.textContent).toBe("user: hi\nmodel: hello");
  });

  it("never renders HTML or Markdown from the content", () => {
    const hostile = [
      "<script>window.__evidencePwned = true</script>",
      '<img src="https://evil.example/x.png" onerror="window.__evidencePwned = true">',
      "# heading",
      "[link](javascript:alert(1))",
      "**bold**",
    ].join("\n");
    const { container } = render(<EvidenceList evidence={[item({ content: hostile, title: "<b>t</b>" })]} />);
    const pre = screen.getByTestId("evidence-content");
    expect(pre.textContent).toBe(hostile);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>t</b>")).toBeInTheDocument();
    expect((window as unknown as { __evidencePwned?: boolean }).__evidencePwned).toBeUndefined();
  });

  it("collapses a long item behind an expand control, and the control shows the whole text", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    render(<EvidenceList evidence={[item({ content: lines.join("\n") })]} />);
    const pre = screen.getByTestId("evidence-content");
    expect(pre.textContent).not.toContain("line 59");
    expect(pre.textContent).toContain("line 0");
    const button = screen.getByRole("button", { name: "Show all" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByTestId("evidence-content").textContent).toBe(lines.join("\n"));
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows a short item whole with no expand control", () => {
    render(<EvidenceList evidence={[item({ content: "short" })]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says when the finding holds no evidence", () => {
    render(<EvidenceList evidence={[]} />);
    expect(screen.getByTestId("evidence-empty")).toBeInTheDocument();
  });

  it("does not claim a source when the tier is missing", () => {
    render(<EvidenceList evidence={[item({ tier: "unknown", toolCallId: "call-9" })]} />);
    expect(screen.getByTestId("evidence-tier")).toHaveTextContent("Source not stated");
    expect(screen.queryByTestId("evidence-tool-call")).toBeNull();
  });
});
