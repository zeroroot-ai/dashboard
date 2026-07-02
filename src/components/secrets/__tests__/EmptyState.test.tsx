import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SecretsEmptyState } from "../EmptyState";

describe("SecretsEmptyState add-secret reachability", () => {
  it("onboarding (Hosted-and-ready) offers the add-secret path", () => {
    render(<SecretsEmptyState variant="onboarding" />);
    const cta = screen.getByRole("link", { name: /add your first secret/i });
    expect(cta).toHaveAttribute(
      "href",
      "/dashboard/pages/settings/secrets/new",
    );
  });

  it("no-secrets (BYO ready) offers the add-secret path", () => {
    render(<SecretsEmptyState variant="no-secrets" />);
    expect(
      screen.getByRole("link", { name: /add your first secret/i }),
    ).toHaveAttribute("href", "/dashboard/pages/settings/secrets/new");
  });

  it("unavailable shows an error state with NO configure-backend dead-end", () => {
    render(<SecretsEmptyState variant="unavailable" />);
    expect(screen.getByText(/secrets backend unavailable/i)).toBeInTheDocument();
    // The old dead-end CTA must be gone.
    expect(
      screen.queryByRole("link", { name: /configure secrets backend/i }),
    ).toBeNull();
    // And it must not offer an add-secret path (broker is down).
    expect(
      screen.queryByRole("link", { name: /add your first secret/i }),
    ).toBeNull();
  });
});
