import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ListPageShell } from "../ListPageShell";

describe("ListPageShell", () => {
  it("renders title, description, and content slots", () => {
    render(
      <ListPageShell title="Agents" description="Manage deployed agents.">
        <div>table goes here</div>
      </ListPageShell>,
    );
    expect(screen.getByTestId("list-page-title")).toHaveTextContent("Agents");
    expect(screen.getByTestId("list-page-description")).toHaveTextContent(
      "Manage deployed agents.",
    );
    expect(screen.getByTestId("list-page-content")).toHaveTextContent(
      "table goes here",
    );
  });

  it("renders the primary CTA slot when provided", () => {
    render(
      <ListPageShell
        title="Agents"
        primaryCta={<button>Deploy</button>}
      >
        <div />
      </ListPageShell>,
    );
    expect(screen.getByTestId("list-page-primary-cta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deploy/i })).toBeInTheDocument();
  });

  it("omits the primary CTA slot when not provided", () => {
    render(
      <ListPageShell title="Agents">
        <div />
      </ListPageShell>,
    );
    expect(screen.queryByTestId("list-page-primary-cta")).not.toBeInTheDocument();
  });

  it("renders the filters slot when provided", () => {
    render(
      <ListPageShell title="Agents" filters={<input placeholder="Search" />}>
        <div />
      </ListPageShell>,
    );
    expect(screen.getByTestId("list-page-filters")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
  });

  it("omits the filters slot when not provided", () => {
    render(
      <ListPageShell title="Agents">
        <div />
      </ListPageShell>,
    );
    expect(screen.queryByTestId("list-page-filters")).not.toBeInTheDocument();
  });

  it("omits description when not provided", () => {
    render(
      <ListPageShell title="Agents">
        <div />
      </ListPageShell>,
    );
    expect(screen.queryByTestId("list-page-description")).not.toBeInTheDocument();
  });
});
