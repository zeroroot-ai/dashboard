// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SpendView } from "../SpendView";
import type { TokenSummary } from "@/src/types/trace";

const SUMMARY: TokenSummary = {
  inputTokens: 12_400,
  outputTokens: 4_800,
  totalTokens: 17_200,
  llmCallCount: 9,
  byModel: [
    {
      model: "claude-haiku-4",
      inputTokens: 2_000,
      outputTokens: 500,
      totalTokens: 2_500,
      callCount: 2,
    },
    {
      model: "claude-sonnet-4",
      inputTokens: 10_400,
      outputTokens: 4_300,
      totalTokens: 14_700,
      callCount: 7,
    },
  ],
};

describe("SpendView", () => {
  it("renders the by-model breakdown sorted by tokens, with no cost", () => {
    const { container } = render(<SpendView summary={SUMMARY} />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // row[0] is the header; sonnet (more tokens) comes first.
    expect(within(rows[1]).getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(within(rows[2]).getByText("claude-haiku-4")).toBeInTheDocument();

    expect(within(rows[0]).queryByText(/cost/i)).toBeNull();
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toMatch(/estimate/i);
  });

  it("handles an empty/zero-spend run without crashing", () => {
    render(
      <SpendView
        summary={{
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          llmCallCount: 0,
          byModel: [],
        }}
      />,
    );
    expect(screen.getByText(/No spend was recorded/i)).toBeInTheDocument();
  });
});
