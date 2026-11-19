// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The body of an Agent Skill is untrusted text. It must never become raw
 * HTML in the page.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentSkillBody } from "../AgentSkillBody";
import { AGENT_SKILL_TEXT as T } from "../texts";

const HOSTILE = [
  "# Title",
  '<script>window.__pwned = true</script>',
  '<img src="https://evil.example/x.png" onerror="window.__pwned = true">',
  "[click](javascript:alert(1))",
  "![remote](https://evil.example/track.png)",
].join("\n\n");

describe("AgentSkillBody", () => {
  it("shows the body as plain text by default, with every tag as text", () => {
    const { container } = render(<AgentSkillBody body={HOSTILE} />);
    const pre = screen.getByTestId("agent-skill-body-plain");
    expect(pre.textContent).toContain("<script>window.__pwned = true</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("makes no raw HTML, no image and no script link in the formatted view", async () => {
    const { container } = render(<AgentSkillBody body={HOSTILE} />);
    await userEvent.click(screen.getByRole("button", { name: T.bodyRendered }));
    const article = screen.getByTestId("agent-skill-body-formatted");
    expect(article.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    }
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("shows the target of a link as text, and opens it with no opener and no referrer", async () => {
    render(<AgentSkillBody body={"Read [the vendor docs](https://evil.example/login?next=x) first."} />);
    await userEvent.click(screen.getByRole("button", { name: T.bodyRendered }));
    const link = screen.getByRole("link", { name: "the vendor docs" });
    expect(link).toHaveAttribute("href", "https://evil.example/login?next=x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByTestId("agent-skill-link-target")).toHaveTextContent("(https://evil.example/login?next=x)");
  });

  it("shows a link with a script target as text only", async () => {
    render(<AgentSkillBody body={"[click](javascript:alert(1))"} />);
    await userEvent.click(screen.getByRole("button", { name: T.bodyRendered }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("click")).toBeInTheDocument();
  });

  it("says so when the body is empty", () => {
    render(<AgentSkillBody body="  " />);
    expect(screen.getByText(T.bodyEmpty)).toBeInTheDocument();
  });
});
