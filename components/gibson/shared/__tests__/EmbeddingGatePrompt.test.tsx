import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import {
  EmbeddingGatePrompt,
  PROVIDERS_SETTINGS_HREF,
} from "@/components/gibson/shared/EmbeddingGatePrompt";

describe("EmbeddingGatePrompt", () => {
  it("renders the configure-embedding-provider call to action", () => {
    render(<EmbeddingGatePrompt />);
    expect(
      screen.getByText(/configure an embedding provider/i),
    ).toBeInTheDocument();
    const cta = screen.getByTestId("embedding-gate-configure");
    expect(cta).toBeInTheDocument();
  });

  it("links to the provider configuration page", () => {
    render(<EmbeddingGatePrompt />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", PROVIDERS_SETTINGS_HREF);
  });

  it("weaves the feature name into the description", () => {
    render(<EmbeddingGatePrompt feature="GraphRAG path search" />);
    expect(
      screen.getByText(/GraphRAG path search needs an embedding provider/i),
    ).toBeInTheDocument();
  });
});
