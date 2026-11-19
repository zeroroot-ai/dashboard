// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  options: vi.fn(),
  agents: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  republish: vi.fn(),
  callers: vi.fn(),
  revoke: vi.fn(),
  add: vi.fn(),
  retire: vi.fn(),
  assert: vi.fn(),
}));

vi.mock("@/app/actions/inbound-missions", () => ({
  listInboundMissionsAction: m.list,
  listInboundPublishOptionsAction: m.options,
  listDefinitionAgentsAction: m.agents,
  publishInboundMissionAction: m.publish,
  unpublishInboundMissionAction: m.unpublish,
  republishInboundMissionAction: m.republish,
  listInboundCallersAction: m.callers,
  revokeInboundCallerAction: m.revoke,
  addInboundCallerAction: m.add,
}));
vi.mock("@/app/actions/crd/member", () => ({ retireAgentIdentityAction: m.retire }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  usePathname: () => "/dashboard",
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/src/lib/auth/assert-authorized", () => ({
  assertAuthorized: m.assert,
  authzDenial: (e: unknown) => (e instanceof Error && e.name === "Denied" ? e : null),
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  generateMeta: () => ({}),
}));

import { InboundMissionsContent } from "../InboundMissionsContent";
import { INBOUND_MISSION_TEXT as T } from "../texts";
import { INBOUND_MISSION_PAGE_METHOD } from "@/src/lib/inbound-missions/gate";
import { navItems } from "@/components/layout/sidebar/nav-main";
import InboundMissionsPage from "@/app/dashboard/(auth)/inbound-missions/page";

const entry = {
  agent: "recon",
  missionDefinitionId: "def-1",
  targetIds: ["t1", "t-gone"],
  maxActiveMissions: 3,
  publishedBy: "user-1",
  createdAt: "2026-11-18T10:00:00.000Z",
  stale: false,
  staleReason: "",
};
const CALLER = "agent_principal:id-1";
const CREDENTIALS = { bootstrapToken: "tok-123", gibsonUrl: "https://gibson.example.com" };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  toast.success.mockReset();
  toast.error.mockReset();
  m.list.mockResolvedValue({ ok: true, data: [] });
  m.options.mockResolvedValue({
    ok: true,
    data: {
      definitions: [{ id: "def-1", name: "recon-flow" }],
      targets: [
        { id: "t1", name: "web" },
        { id: "t2", name: "api" },
      ],
    },
  });
  m.agents.mockResolvedValue({ ok: true, data: ["recon", "scan"] });
  m.callers.mockResolvedValue({ ok: true, data: { items: [], truncated: false } });
});

async function fillPublishForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText(T.fieldDefinition), "def-1");
  await waitFor(() => expect(screen.getByLabelText(T.fieldAgent)).toBeEnabled());
  await user.selectOptions(screen.getByLabelText(T.fieldAgent), "recon");
  await user.click(screen.getByRole("checkbox", { name: "web" }));
  await user.type(screen.getByLabelText(T.fieldMaxMissions), "3");
  await user.type(screen.getByLabelText(T.fieldCallerName), "partner");
}

describe("the list of published definitions", () => {
  it("shows the agent, the definition, the targets, the publisher and the time", async () => {
    m.list.mockResolvedValue({ ok: true, data: [entry] });
    render(<InboundMissionsContent />);
    const row = await screen.findByTestId("inbound-mission-row");
    expect(within(row).getByText("recon")).toBeInTheDocument();
    expect(await within(row).findByText("recon-flow")).toBeInTheDocument();
    expect(within(row).getByText("web")).toBeInTheDocument();
    // A target that the list of targets does not hold shows as its id.
    expect(within(row).getByText("t-gone")).toBeInTheDocument();
    expect(within(row).getByTestId("max-missions")).toHaveTextContent("3");
    expect(within(row).getByText("user-1")).toBeInTheDocument();
    expect(within(row).getByText(new Date(entry.createdAt).toLocaleString())).toBeInTheDocument();
  });

  it("states that the workspace has none, and shows a load error", async () => {
    const { unmount } = render(<InboundMissionsContent />);
    expect(await screen.findByTestId("inbound-missions-empty")).toHaveTextContent(T.empty);
    unmount();
    m.list.mockResolvedValueOnce({ ok: false, error: "Unavailable." });
    render(<InboundMissionsContent />);
    expect(await screen.findByText("Unavailable.")).toBeInTheDocument();
  });

  it("unpublishes after the confirm dialog and reads the list again", async () => {
    m.list.mockResolvedValue({ ok: true, data: [entry] });
    m.unpublish.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await user.click(await screen.findByRole("button", { name: `${T.unpublishButton} recon` }));
    await user.click(screen.getByRole("button", { name: T.unpublishConfirm }));
    expect(m.unpublish).toHaveBeenCalledWith("recon");
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("a stale publication", () => {
  const stale = { ...entry, stale: true, staleReason: "an approved target changed after it was published" };

  it("shows no stale state for a publication that matches", async () => {
    m.list.mockResolvedValue({ ok: true, data: [entry] });
    render(<InboundMissionsContent />);
    await screen.findByTestId("inbound-mission-row");
    expect(screen.queryByTestId("stale-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stale-row")).not.toBeInTheDocument();
  });

  it("shows the state and the reason, and publishes again with the same fields", async () => {
    m.list.mockResolvedValue({ ok: true, data: [stale] });
    m.republish.mockResolvedValue({ ok: true, data: entry });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    expect(await screen.findByTestId("stale-badge")).toHaveTextContent(T.staleBadge);
    const row = screen.getByTestId("stale-row");
    expect(row).toHaveTextContent(T.staleBody);
    expect(within(row).getByTestId("stale-reason")).toHaveTextContent(stale.staleReason);
    await user.click(within(row).getByRole("button", { name: `${T.republishButton} recon` }));
    // The dialog states what the admin approves: the reason of the daemon.
    expect(within(screen.getByRole("alertdialog")).getByTestId("republish-reason")).toHaveTextContent(
      stale.staleReason,
    );
    await user.click(screen.getByRole("button", { name: T.republishConfirm }));
    // The page sends the agent name only. The server reads the stored entry.
    expect(m.republish).toHaveBeenCalledWith("recon");
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows the refusal of the daemon when it cannot publish again", async () => {
    m.list.mockResolvedValue({ ok: true, data: [stale] });
    m.republish.mockResolvedValue({ ok: false, error: "the target does not exist: t-gone", code: "not_found" });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await user.click(await screen.findByRole("button", { name: `${T.republishButton} recon` }));
    await user.click(screen.getByRole("button", { name: T.republishConfirm }));
    expect(await screen.findByTestId("republish-error")).toHaveTextContent("the target does not exist: t-gone");
  });
});

describe("the publish form", () => {
  it("offers only the agents of the chosen definition, and no identity that exists", async () => {
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await user.selectOptions(await screen.findByLabelText(T.fieldDefinition), "def-1");
    expect(m.agents).toHaveBeenCalledWith("recon-flow");
    await waitFor(() => expect(screen.getByLabelText(T.fieldAgent)).toBeEnabled());
    const agentOptions = within(screen.getByLabelText(T.fieldAgent)).getAllByRole("option");
    expect(agentOptions.map((o) => o.textContent)).toEqual([T.agentNone, "recon", "scan"]);
    // The caller is a text field for a new name. The form has no identity picker.
    expect(screen.getByLabelText(T.fieldCallerName).tagName).toBe("INPUT");
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("sends the choice, shows the credentials one time, and reads the list again", async () => {
    m.publish.mockResolvedValue({
      ok: true,
      caller: { identityId: CALLER, name: "partner" },
      credentials: CREDENTIALS,
    });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await fillPublishForm(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    expect(m.publish).toHaveBeenCalledWith({
      agent: "recon",
      missionDefinitionId: "def-1",
      targetIds: ["t1"],
      maxActiveMissions: 3,
      callerName: "partner",
    });
    expect(await screen.findByText(T.credentialsTitle("partner"))).toBeInTheDocument();
    expect(screen.getByLabelText("Bootstrap token")).toHaveValue("tok-123");
    expect(screen.getByLabelText("Platform URL")).toHaveValue("https://gibson.example.com");
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(1));
    expect(toast.success).toHaveBeenCalledWith(T.published("recon"));
    await user.click(screen.getByRole("button", { name: "I have saved them" }));
    expect(screen.queryByLabelText("Bootstrap token")).not.toBeInTheDocument();
    expect(screen.getByLabelText(T.fieldCallerName)).toHaveValue("");
  });

  it("keeps the Publish button off until each field has a value", async () => {
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    expect(await screen.findByRole("button", { name: T.publishButton })).toBeDisabled();
    await fillPublishForm(user);
    expect(screen.getByRole("button", { name: T.publishButton })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "web" }));
    expect(screen.getByRole("button", { name: T.publishButton })).toBeDisabled();
  });

  it("gives the limit no default, and needs a whole number of at least 1", async () => {
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await fillPublishForm(user);
    const limit = screen.getByLabelText(T.fieldMaxMissions);
    expect(limit).toBeRequired();
    await user.clear(limit);
    expect(limit).toHaveValue(null);
    expect(screen.getByRole("button", { name: T.publishButton })).toBeDisabled();
    await user.type(limit, "0");
    expect(screen.getByRole("button", { name: T.publishButton })).toBeDisabled();
    await user.clear(limit);
    await user.type(limit, "2");
    expect(screen.getByRole("button", { name: T.publishButton })).toBeEnabled();
  });

  it("shows what was made when the publish step fails, and shows no token", async () => {
    m.publish.mockResolvedValue({
      ok: false,
      error: "the definition has no agent node",
      code: "invalid_argument",
      failedStep: "publish",
      identity: { identityId: CALLER, name: "partner", removed: true },
      published: false,
    });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await fillPublishForm(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    expect(await screen.findByTestId("flow-failed-step")).toHaveTextContent(T.failedPublish);
    expect(screen.getByTestId("flow-error")).toHaveTextContent("the definition has no agent node");
    expect(screen.getByTestId("flow-identity-state")).toHaveTextContent(T.identityRemoved("partner"));
    expect(screen.getByTestId("flow-publication-state")).toHaveTextContent(T.definitionNotPublished);
    expect(screen.queryByLabelText("Bootstrap token")).not.toBeInTheDocument();
    expect(screen.getByLabelText(T.fieldCallerName)).toHaveValue("partner");
  });

  it("states a publication with no caller and an identity that stays, when the grant step fails", async () => {
    m.publish.mockResolvedValue({
      ok: false,
      error: "the identity holds another grant",
      code: "failed_precondition",
      failedStep: "grant",
      identity: { identityId: CALLER, name: "partner", removed: false },
      published: true,
    });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await fillPublishForm(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    expect(await screen.findByTestId("flow-failed-step")).toHaveTextContent(T.failedGrant);
    expect(screen.getByTestId("flow-error")).toHaveTextContent("the identity holds another grant");
    expect(screen.getByTestId("flow-identity-state")).toHaveTextContent(T.identityLeft("partner", CALLER));
    expect(screen.getByTestId("flow-publication-state")).toHaveTextContent(T.definitionPublished);
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(1));
    // The flow failed, so no message of success shows next to the failure.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the note of a revoke that did not finish, and sends the revoke again", async () => {
    const note =
      "the identity is revoked and its access is blocked, but the cleanup of its permission tuples did not finish. Retry the revoke to finish the cleanup";
    m.publish.mockResolvedValue({
      ok: false,
      error: "refused",
      code: "invalid_argument",
      failedStep: "publish",
      identity: { identityId: CALLER, name: "partner", removed: false, revokeNote: note },
      published: false,
    });
    m.retire
      .mockResolvedValueOnce({ ok: false, error: "[unavailable] upstream reset 10.0.3.4", code: "INTERNAL" })
      .mockResolvedValueOnce({ ok: false, error: "[unavailable] " + note, code: "INTERNAL" })
      .mockResolvedValueOnce({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await fillPublishForm(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    expect(await screen.findByTestId("flow-revoke-note")).toHaveTextContent("Retry the revoke to finish the cleanup");
    await user.click(screen.getByRole("button", { name: T.retryRevokeButton }));
    expect(m.retire).toHaveBeenCalledWith({ principalId: CALLER });
    // A proxy error shows as a fixed text, with no detail of the network.
    expect(await screen.findByTestId("flow-revoke-error")).toHaveTextContent(T.retryRevokeFailed);
    expect(screen.getByTestId("flow-failure")).not.toHaveTextContent("10.0.3.4");
    await user.click(screen.getByRole("button", { name: T.retryRevokeButton }));
    await waitFor(() =>
      expect(screen.getByTestId("flow-revoke-error")).toHaveTextContent("Retry the revoke to finish the cleanup"),
    );
    await user.click(screen.getByRole("button", { name: T.retryRevokeButton }));
    expect(await screen.findByTestId("flow-identity-revoked")).toHaveTextContent(T.identityRevokedNow("partner"));
  });

  it("states that nothing was made when the identity step fails", async () => {
    m.publish.mockResolvedValue({
      ok: false,
      error: "an agent with that name exists",
      code: "already_exists",
      failedStep: "identity",
      published: false,
    });
    const user = userEvent.setup();
    render(<InboundMissionsContent />);
    await fillPublishForm(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    expect(await screen.findByTestId("flow-identity-state")).toHaveTextContent(T.identityNotMade);
    expect(screen.getByTestId("flow-publication-state")).toHaveTextContent(T.definitionNotPublished);
  });

  it("shows an error when the options do not load, and shows no form", async () => {
    m.options.mockResolvedValue({ ok: false, error: "Down." });
    render(<InboundMissionsContent />);
    expect(await screen.findByText("Down.")).toBeInTheDocument();
    expect(screen.queryByLabelText(T.fieldDefinition)).not.toBeInTheDocument();
  });
});

describe("the callers of one publication", () => {
  async function openCallers(user: ReturnType<typeof userEvent.setup>) {
    m.list.mockResolvedValue({ ok: true, data: [entry] });
    render(<InboundMissionsContent />);
    await user.click(await screen.findByRole("button", { name: `${T.callersButton} recon` }));
    return screen.findByTestId("inbound-callers");
  }

  it("lists each caller and revokes one", async () => {
    m.callers.mockResolvedValue({
      ok: true,
      data: {
        items: [
          { identityId: CALLER, name: "partner" },
          { identityId: "agent_principal:id-2", name: "" },
        ],
        truncated: false,
      },
    });
    m.revoke.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    const panel = await openCallers(user);
    expect(m.callers).toHaveBeenCalledWith("recon");
    const rows = await within(panel).findAllByTestId("caller-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(CALLER)).toBeInTheDocument();
    expect(within(rows[1]).getByText(T.unknownCaller)).toBeInTheDocument();
    await user.click(within(rows[0]).getByRole("button", { name: `${T.revokeButton} partner` }));
    expect(m.revoke).toHaveBeenCalledWith({ agent: "recon", identityId: CALLER });
    await waitFor(() => expect(m.callers.mock.calls.length).toBeGreaterThan(1));
  });

  it("says that the caller list is cut when the walk stopped at its bound", async () => {
    m.callers.mockResolvedValue({
      ok: true,
      data: { items: [{ identityId: CALLER, name: "partner" }], truncated: true },
    });
    const user = userEvent.setup();
    const panel = await openCallers(user);
    expect(await within(panel).findByTestId("callers-cut")).toHaveTextContent(T.callersCut(1));
  });

  it("states that no identity can call", async () => {
    const user = userEvent.setup();
    const panel = await openCallers(user);
    expect(await within(panel).findByTestId("callers-empty")).toHaveTextContent(T.callersEmpty);
  });

  it("adds a new caller and shows its credentials one time", async () => {
    m.add.mockResolvedValue({
      ok: true,
      caller: { identityId: "agent_principal:id-9", name: "second" },
      credentials: CREDENTIALS,
    });
    const user = userEvent.setup();
    const panel = await openCallers(user);
    await user.type(within(panel).getByLabelText(T.fieldCallerName), "second");
    await user.click(within(panel).getByRole("button", { name: T.addCallerButton }));
    expect(m.add).toHaveBeenCalledWith({ agent: "recon", callerName: "second" });
    expect(await within(panel).findByText(T.credentialsTitle("second"))).toBeInTheDocument();
    expect(within(panel).getByLabelText("Bootstrap token")).toHaveValue("tok-123");
    await user.click(within(panel).getByRole("button", { name: "I have saved them" }));
    expect(within(panel).queryByLabelText("Bootstrap token")).not.toBeInTheDocument();
  });

  it("shows the refusal of the daemon when a new caller gets no grant", async () => {
    m.add.mockResolvedValue({
      ok: false,
      error: "the identity holds another grant",
      code: "failed_precondition",
      failedStep: "grant",
      identity: { identityId: "agent_principal:id-9", name: "second", removed: true },
      published: true,
    });
    const user = userEvent.setup();
    const panel = await openCallers(user);
    await user.type(within(panel).getByLabelText(T.fieldCallerName), "second");
    await user.click(within(panel).getByRole("button", { name: T.addCallerButton }));
    expect(await within(panel).findByTestId("flow-error")).toHaveTextContent("the identity holds another grant");
    expect(within(panel).getByTestId("flow-identity-state")).toHaveTextContent(T.identityRemoved("second"));
  });
});

describe("the nav entry and the page are for the tenant admin", () => {
  it("has a gated nav entry named Inbound missions", () => {
    const item = navItems.flatMap((g) => g.items).find((i) => i.href === "/dashboard/inbound-missions");
    expect(item?.gate).toBe("inbound-missions");
    expect(item?.title).toBe("Inbound missions");
  });

  it("renders for an admin after the check of the RPC, and redirects a refused role", async () => {
    m.assert.mockResolvedValue(undefined);
    render(await InboundMissionsPage());
    expect(m.assert).toHaveBeenCalledWith(INBOUND_MISSION_PAGE_METHOD);
    const denied = new Error("denied");
    denied.name = "Denied";
    m.assert.mockRejectedValue(denied);
    await expect(InboundMissionsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});
