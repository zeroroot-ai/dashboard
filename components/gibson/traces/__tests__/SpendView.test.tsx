import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SpendView } from "../SpendView";
import type { TokenSummary } from "@/src/types/trace";

const SUMMARY: TokenSummary = {
  inputTokens: 12_400,
  outputTokens: 4_800,
  totalTokens: 17_200,
  estimatedCostUsd: 0.42,
  llmCallCount: 9,
  byModel: [
    {
      model: "claude-haiku-4",
      inputTokens: 2_000,
      outputTokens: 500,
      totalTokens: 2_500,
      callCount: 2,
      estimatedCostUsd: 0.03,
    },
    {
      model: "claude-sonnet-4",
      inputTokens: 10_400,
      outputTokens: 4_300,
      totalTokens: 14_700,
      callCount: 7,
      estimatedCostUsd: 0.39,
    },
  ],
};

describe("SpendView", () => {
  it("renders the by-model breakdown sorted by spend", () => {
    render(<SpendView summary={SUMMARY} />);

    // by-model sorted by cost desc: sonnet ($0.39) before haiku ($0.03)
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getByText("$0.39")).toBeInTheDocument();
    expect(screen.getByText("$0.03")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // row[0] is the header; sonnet (higher cost) comes first.
    expect(within(rows[1]).getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(within(rows[2]).getByText("claude-haiku-4")).toBeInTheDocument();
  });

  it("shows a dash for models with no known pricing instead of a fake $0", () => {
    render(
      <SpendView
        summary={{
          ...SUMMARY,
          byModel: [
            {
              model: "mystery-model",
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
              callCount: 1,
              estimatedCostUsd: 0,
            },
          ],
        }}
      />,
    );
    const row = screen.getByText("mystery-model").closest("tr")!;
    expect(within(row).getByText("-")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("handles an empty/zero-spend run without crashing", () => {
    render(
      <SpendView
        summary={{
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          llmCallCount: 0,
          byModel: [],
        }}
      />,
    );
    expect(screen.getByText(/No spend was recorded/i)).toBeInTheDocument();
  });
});
