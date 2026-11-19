// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The nav entry and the pages of the Agent Skills are for the tenant admin
 * only. The entry sits behind AuthorizedNavGate on the ListAgentSkills RPC.
 * The page redirects a role that the RPC refuses.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { auth, seen, redirectMock, assertMock } = vi.hoisted(() => ({
  auth: { allowed: true, loading: false },
  seen: { methods: [] as string[] },
  redirectMock: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  assertMock: vi.fn(),
}));

vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: (method: string) => {
    seen.methods.push(method);
    return auth;
  },
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/src/lib/auth/assert-authorized", () => ({
  assertAuthorized: assertMock,
  authzDenial: (e: unknown) => (e instanceof Error && e.name === "Denied" ? e : null),
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  generateMeta: () => ({}),
}));
vi.mock("@/components/gibson/agent-skills/AgentSkillsContent", () => ({
  AgentSkillsContent: () => <div>list page</div>,
}));
vi.mock("@/components/gibson/agent-skills/AgentSkillDetail", () => ({
  AgentSkillDetail: ({ name }: { name: string }) => <div>detail of {name}</div>,
}));

import { AuthorizedNavGate } from "@/components/gibson/auth/AuthorizedNavGate";
import { navItems } from "@/components/layout/sidebar/nav-main";
import { AGENT_SKILL_PAGE_METHOD } from "@/src/lib/agent-skills/gate";
import AgentSkillsPage from "@/app/dashboard/(auth)/agent-skills/page";
import AgentSkillDetailPage from "@/app/dashboard/(auth)/agent-skills/[name]/page";
import { AGENT_SKILL_TEXT } from "../texts";

beforeEach(() => {
  auth.allowed = true;
  auth.loading = false;
  seen.methods = [];
  assertMock.mockReset().mockResolvedValue(undefined);
  redirectMock.mockClear();
});

function denied(): Error {
  const e = new Error("denied");
  e.name = "Denied";
  return e;
}

describe("the nav entry", () => {
  const entry = navItems.flatMap((g) => g.items).find((i) => i.href === "/dashboard/agent-skills");

  it("exists, carries the gate, and uses the name Agent Skills", () => {
    expect(entry).toBeDefined();
    expect(entry?.gate).toBe("agent-skills");
    expect(entry?.title).toBe(AGENT_SKILL_TEXT.menu);
    expect(entry?.title).toBe("Agent Skills");
  });

  it("shows for a role that the RPC allows, and asks the right RPC", () => {
    render(
      <AuthorizedNavGate method={AGENT_SKILL_PAGE_METHOD}>
        <span>entry</span>
      </AuthorizedNavGate>,
    );
    expect(screen.getByText("entry")).toBeInTheDocument();
    expect(seen.methods).toEqual(["/gibson.tenant.v1.AgentSkillService/ListAgentSkills"]);
  });

  it("hides for a role that the RPC refuses, and while the answer loads", () => {
    auth.allowed = false;
    const { rerender } = render(
      <AuthorizedNavGate method={AGENT_SKILL_PAGE_METHOD}>
        <span>entry</span>
      </AuthorizedNavGate>,
    );
    expect(screen.queryByText("entry")).toBeNull();
    auth.allowed = true;
    auth.loading = true;
    rerender(
      <AuthorizedNavGate method={AGENT_SKILL_PAGE_METHOD}>
        <span>entry</span>
      </AuthorizedNavGate>,
    );
    expect(screen.queryByText("entry")).toBeNull();
  });
});

describe("the pages", () => {
  it("render for an admin, after the check of the RPC", async () => {
    const ui = await AgentSkillsPage();
    render(ui);
    expect(screen.getByText("list page")).toBeInTheDocument();
    expect(assertMock).toHaveBeenCalledWith(AGENT_SKILL_PAGE_METHOD);
  });

  it("send a refused role to the dashboard home", async () => {
    assertMock.mockRejectedValue(denied());
    await expect(AgentSkillsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    await expect(
      AgentSkillDetailPage({ params: Promise.resolve({ name: "triage" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("decode the name of the detail page", async () => {
    render(await AgentSkillDetailPage({ params: Promise.resolve({ name: "my%20skill" }) }));
    expect(screen.getByText("detail of my skill")).toBeInTheDocument();
  });

  it("do not hide an error that is not a denial", async () => {
    assertMock.mockRejectedValue(new Error("boom"));
    await expect(AgentSkillsPage()).rejects.toThrow("boom");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
