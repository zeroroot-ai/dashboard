// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  register: vi.fn(),
  del: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  grants: vi.fn(),
  missions: vi.fn(),
  secrets: vi.fn(),
  assert: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/app/actions/outside-agents", () => ({
  listOutsideAgentsAction: m.list,
  getOutsideAgentAction: m.get,
  registerOutsideAgentAction: m.register,
  deleteOutsideAgentAction: m.del,
  grantOutsideAgentAction: m.grant,
  revokeOutsideAgentAction: m.revoke,
  listOutsideAgentGrantsAction: m.grants,
}));
vi.mock("@/app/actions/agent-skills", () => ({ listMissionOptionsAction: m.missions }));
vi.mock("@/app/actions/read/listSecretNames", () => ({ listSecretNamesAction: m.secrets }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  usePathname: () => "/dashboard",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/src/lib/auth/assert-authorized", () => ({
  assertAuthorized: m.assert,
  authzDenial: (e: unknown) => (e instanceof Error && e.name === "Denied" ? e : null),
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  generateMeta: () => ({}),
}));

import { OutsideAgentsContent } from "../OutsideAgentsContent";
import { OutsideAgentDetail } from "../OutsideAgentDetail";
import { OUTSIDE_AGENT_TEXT as T } from "../texts";
import { OUTSIDE_AGENT_PAGE_METHOD } from "@/src/lib/outside-agents/gate";
import { navItems } from "@/components/layout/sidebar/nav-main";
import OutsideAgentsPage from "@/app/dashboard/(auth)/outside-agents/page";
import OutsideAgentDetailPage from "@/app/dashboard/(auth)/outside-agents/[name]/page";

const agent = {
  name: "scout",
  a2aUrl: "https://agent.example.com/a2a",
  credentialSecret: "cred",
  caBundleSecret: "",
  description: "Outside scout",
  createdAt: "2026-11-18T10:00:00.000Z",
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.secrets.mockResolvedValue({ ok: true, data: ["cred", "ca-1"] });
  m.missions.mockResolvedValue({ ok: true, data: [] });
  m.grants.mockResolvedValue({ ok: true, data: [] });
});

describe("OutsideAgentsContent", () => {
  it("lists each outside agent with a link to its page", async () => {
    m.list.mockResolvedValue({ ok: true, data: [agent] });
    render(<OutsideAgentsContent />);
    const row = await screen.findByTestId("outside-agent-row");
    expect(within(row).getByRole("link", { name: "scout" })).toHaveAttribute("href", "/dashboard/outside-agents/scout");
    expect(within(row).getByText("https://agent.example.com/a2a")).toBeInTheDocument();
  });

  it("states that the workspace has none, and shows a load error", async () => {
    m.list.mockResolvedValueOnce({ ok: true, data: [] });
    const { unmount } = render(<OutsideAgentsContent />);
    expect(await screen.findByTestId("outside-agents-empty")).toHaveTextContent(T.empty);
    unmount();
    m.list.mockResolvedValueOnce({ ok: false, error: "Unavailable." });
    render(<OutsideAgentsContent />);
    expect(await screen.findByText("Unavailable.")).toBeInTheDocument();
  });

  it("registers with the chosen secrets, then reloads the list", async () => {
    m.list.mockResolvedValue({ ok: true, data: [] });
    m.register.mockResolvedValue({ ok: true, data: agent });
    const user = userEvent.setup();
    render(<OutsideAgentsContent />);
    await screen.findAllByRole("option", { name: "cred" });
    await user.type(screen.getByLabelText(T.fieldName), "scout");
    await user.type(screen.getByLabelText(T.fieldUrl), "https://agent.example.com/a2a");
    await user.selectOptions(screen.getByLabelText(T.fieldCredential), "cred");
    await user.selectOptions(screen.getByLabelText(T.fieldCaBundle), "ca-1");
    await user.click(screen.getByRole("button", { name: T.registerButton }));
    expect(m.register).toHaveBeenCalledWith({
      name: "scout",
      a2aUrl: "https://agent.example.com/a2a",
      credentialSecret: "cred",
      caBundleSecret: "ca-1",
      description: "",
    });
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows the error of the daemon as text and keeps the input", async () => {
    m.list.mockResolvedValue({ ok: true, data: [] });
    m.register.mockResolvedValue({ ok: false, error: "the URL resolves to a private address", code: "invalid_argument" });
    const user = userEvent.setup();
    render(<OutsideAgentsContent />);
    await user.type(await screen.findByLabelText(T.fieldName), "scout");
    await user.type(screen.getByLabelText(T.fieldUrl), "https://10.0.0.1/a2a");
    await user.click(screen.getByRole("button", { name: T.registerButton }));
    expect(await screen.findByTestId("register-error")).toHaveTextContent("the URL resolves to a private address");
    expect(screen.getByLabelText(T.fieldName)).toHaveValue("scout");
  });
});

describe("OutsideAgentDetail", () => {
  it("shows the record and the present grants, and revokes one", async () => {
    m.get.mockResolvedValue({ ok: true, data: agent });
    m.grants.mockResolvedValue({ ok: true, data: ["m1", "m2"] });
    m.revoke.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<OutsideAgentDetail name="scout" />);
    expect(await screen.findByText("https://agent.example.com/a2a")).toBeInTheDocument();
    const rows = await screen.findAllByTestId("grant-row");
    expect(rows).toHaveLength(2);
    await user.click(within(rows[0]).getByRole("button", { name: `${T.revokeButton} m1` }));
    expect(m.revoke).toHaveBeenCalledWith({ name: "scout", missionId: "m1" });
    await waitFor(() => expect(m.grants.mock.calls.length).toBeGreaterThan(1));
  });

  it("states that no mission has a grant", async () => {
    m.get.mockResolvedValue({ ok: true, data: agent });
    render(<OutsideAgentDetail name="scout" />);
    expect(await screen.findByTestId("grants-empty")).toHaveTextContent(T.grantsEmpty);
  });

  it("grants a mission from the picker, and falls back to a text field", async () => {
    m.get.mockResolvedValue({ ok: true, data: agent });
    m.grant.mockResolvedValue({ ok: true, data: null });
    m.missions.mockResolvedValue({ ok: true, data: [{ id: "m-7", name: "Recon" }] });
    const user = userEvent.setup();
    render(<OutsideAgentDetail name="scout" />);
    await user.selectOptions(await screen.findByLabelText(T.fieldMissionPick), "m-7");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(m.grant).toHaveBeenCalledWith({ name: "scout", missionId: "m-7" });
    await user.click(screen.getByRole("button", { name: T.pickerEnterId }));
    await user.type(screen.getByLabelText(T.fieldMissionId), "m-typed");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(m.grant).toHaveBeenLastCalledWith({ name: "scout", missionId: "m-typed" });
  });

  it("uses a text field when no mission list loads, and shows a refused grant as text", async () => {
    m.get.mockResolvedValue({ ok: true, data: agent });
    m.grant.mockResolvedValue({ ok: false, error: "No such mission.", code: "not_found" });
    const user = userEvent.setup();
    render(<OutsideAgentDetail name="scout" />);
    await user.type(await screen.findByLabelText(T.fieldMissionId), "zz");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(await screen.findByTestId("grant-error")).toHaveTextContent("No such mission.");
  });

  it("deletes after the confirm dialog and returns to the list", async () => {
    m.get.mockResolvedValue({ ok: true, data: agent });
    m.del.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<OutsideAgentDetail name="scout" />);
    await user.click(await screen.findByRole("button", { name: T.deleteButton }));
    await user.click(screen.getByRole("button", { name: T.deleteConfirm }));
    expect(m.del).toHaveBeenCalledWith("scout");
    await waitFor(() => expect(m.push).toHaveBeenCalledWith("/dashboard/outside-agents"));
  });

  it("says when the outside agent does not exist, and when it cannot load", async () => {
    m.get.mockResolvedValueOnce({ ok: true, data: null });
    const { unmount } = render(<OutsideAgentDetail name="gone" />);
    expect(await screen.findByText(T.notFound)).toBeInTheDocument();
    unmount();
    m.get.mockResolvedValueOnce({ ok: false, error: "Down." });
    render(<OutsideAgentDetail name="gone" />);
    expect(await screen.findByText("Down.")).toBeInTheDocument();
  });
});

describe("the nav entry and the pages are for the tenant admin", () => {
  it("has a gated nav entry named Outside agents", () => {
    const entry = navItems.flatMap((g) => g.items).find((i) => i.href === "/dashboard/outside-agents");
    expect(entry?.gate).toBe("outside-agents");
    expect(entry?.title).toBe("Outside agents");
  });

  it("render for an admin after the check of the RPC, and redirect a refused role", async () => {
    m.assert.mockResolvedValue(undefined);
    render(await OutsideAgentsPage());
    expect(m.assert).toHaveBeenCalledWith(OUTSIDE_AGENT_PAGE_METHOD);
    cleanupDenied();
    await expect(OutsideAgentsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    await expect(OutsideAgentDetailPage({ params: Promise.resolve({ name: "scout" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
  });

  function cleanupDenied() {
    const e = new Error("denied");
    e.name = "Denied";
    m.assert.mockRejectedValue(e);
    m.list.mockResolvedValue({ ok: true, data: [] });
  }
});
