import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";

import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("renders title, description, and icon", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No agents yet"
        description="Deploy your first agent to get started."
      />,
    );
    expect(screen.getByTestId("empty-state-title")).toHaveTextContent("No agents yet");
    expect(screen.getByTestId("empty-state-description")).toHaveTextContent(
      "Deploy your first agent to get started.",
    );
    expect(screen.getByTestId("empty-state-icon")).toBeInTheDocument();
  });

  it("omits the icon slot when no icon is provided", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByTestId("empty-state-icon")).not.toBeInTheDocument();
  });

  it("omits the description slot when not provided", () => {
    render(<EmptyState title="No data" />);
    expect(screen.queryByTestId("empty-state-description")).not.toBeInTheDocument();
  });

  it("renders primary and secondary CTAs in the actions slot", () => {
    render(
      <EmptyState
        title="No agents yet"
        primaryCta={<button>Deploy</button>}
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- test verifies component accepts arbitrary CTA children; not a real navigation anchor
        secondaryCta={<a href="/docs">Read docs</a>}
      />,
    );
    expect(screen.getByTestId("empty-state-actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deploy/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /read docs/i })).toBeInTheDocument();
  });

  it("omits the actions slot entirely when no CTAs are provided", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByTestId("empty-state-actions")).not.toBeInTheDocument();
  });
});
