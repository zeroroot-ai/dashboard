// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The list page shows each Agent Skill with a short digest, a publish time
 * and a source, and the Shared tab enables an Agent Skill. The detail page
 * shows the body, the files and the versions, and a line diff of two digests.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  shared: vi.fn(),
  enable: vi.fn(),
  versions: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  grants: vi.fn(),
  missions: vi.fn(),
  agents: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/app/actions/agent-skills", () => ({
  listAgentSkillsAction: m.list,
  listSharedAgentSkillsAction: m.shared,
  enableSharedAgentSkillAction: m.enable,
  listAgentSkillVersionsAction: m.versions,
  getAgentSkillAction: m.get,
  deleteAgentSkillAction: m.del,
  publishAgentSkillAction: vi.fn(),
  grantAgentSkillAction: m.grant,
  revokeAgentSkillAction: m.revoke,
  listAgentSkillGrantsAction: m.grants,
  listMissionOptionsAction: m.missions,
}));
vi.mock("@/app/actions/read/listAgentIdentities", () => ({ listAgentIdentitiesAction: m.agents }));
vi.mock("@/app/actions/read/listSecretNames", () => ({
  listSecretNamesAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AgentSkillsContent } from "../AgentSkillsContent";
import { AgentSkillDetail } from "../AgentSkillDetail";
import { AGENT_SKILL_TEXT as T } from "../texts";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
function entry(over: Record<string, unknown> = {}) {
  return {
    name: "triage",
    digest: `sha256:${HEX_A}`,
    reference: `reg.example/t/triage@sha256:${HEX_A}`,
    description: "Sort findings",
    license: "",
    compatibility: "",
    metadata: {},
    allowedTools: [],
    publishedAt: "2026-11-18T10:00:00.000Z",
    current: true,
    source: "tenant",
    ...over,
  };
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.grants.mockResolvedValue({ ok: true, data: [] });
  m.missions.mockResolvedValue({ ok: true, data: [] });
  m.agents.mockResolvedValue({ ok: true, data: [] });
});

describe("AgentSkillsContent", () => {
  it("shows the name, the short digest and the source of each entry", async () => {
    m.list.mockResolvedValue({
      ok: true,
      data: [entry({ source: "shared" }), entry({ name: "mine", digest: `sha256:${HEX_B}` })],
    });
    m.shared.mockResolvedValue({ ok: true, data: [] });
    render(<AgentSkillsContent />);
    const rows = await screen.findAllByTestId("agent-skill-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("sha256:aaaaaaaaaaaa")).toBeInTheDocument();
    expect(within(rows[0]).getByText(T.sourceShared)).toBeInTheDocument();
    expect(within(rows[1]).getByText(T.sourceTenant)).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "triage" })).toHaveAttribute(
      "href",
      "/dashboard/agent-skills/triage",
    );
  });

  it("states that the workspace has no Agent Skill", async () => {
    m.list.mockResolvedValue({ ok: true, data: [] });
    m.shared.mockResolvedValue({ ok: true, data: [] });
    render(<AgentSkillsContent />);
    expect(await screen.findByTestId("agent-skills-empty")).toHaveTextContent(T.empty);
  });

  it("shows an error and a retry when the list fails", async () => {
    m.list.mockResolvedValue({ ok: false, error: "The service is unavailable." });
    m.shared.mockResolvedValue({ ok: true, data: [] });
    render(<AgentSkillsContent />);
    expect(await screen.findByText("The service is unavailable.")).toBeInTheDocument();
  });

  it("enables a Shared Agent Skill from the Shared tab", async () => {
    m.list.mockResolvedValue({ ok: true, data: [] });
    m.shared.mockResolvedValue({
      ok: true,
      data: [{ name: "triage", description: "d", digest: `sha256:${HEX_A}`, enabled: false }],
    });
    m.enable.mockResolvedValue({ ok: true, data: entry() });
    const user = userEvent.setup();
    render(<AgentSkillsContent />);
    await user.click(await screen.findByRole("tab", { name: T.tabShared }));
    await user.click(await screen.findByRole("button", { name: `${T.enableButton} triage` }));
    expect(m.enable).toHaveBeenCalledWith("triage");
    await waitFor(() => expect(m.list.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("AgentSkillDetail", () => {
  const v1 = entry();
  const v0 = entry({ digest: `sha256:${HEX_B}`, current: false });

  function setup(bodyNew: string, bodyOld: string) {
    m.versions.mockResolvedValue({ ok: true, data: [v1, v0] });
    m.get.mockImplementation(async (_name: string, digest: string) => {
      const old = digest === v0.digest;
      return {
        ok: true,
        data: {
          entry: old ? v0 : v1,
          body: old ? bodyOld : bodyNew,
          files: [{ path: "scripts/run.sh", sizeBytes: 2048 }],
        },
      };
    });
  }

  it("shows the body, the files and the versions", async () => {
    setup("line one\nline two", "line one");
    render(<AgentSkillDetail name="triage" />);
    expect(await screen.findByTestId("agent-skill-body-plain")).toHaveTextContent("line one");
    expect(screen.getByTestId("file-row")).toHaveTextContent("scripts/run.sh");
    expect(screen.getByTestId("file-row")).toHaveTextContent("2.0 KB");
    expect(screen.getAllByTestId("version-row")).toHaveLength(2);
  });

  it("compares two digests and shows the changed lines", async () => {
    setup("line one\nline two", "line one\nold two");
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    await screen.findByTestId("agent-skill-body-plain");
    // The form starts with the newest as "To" and the next as "From".
    await user.click(screen.getByRole("button", { name: T.diffButton }));
    const diff = await screen.findByTestId("line-diff");
    expect(diff.querySelector('[data-kind="remove"]')).toHaveTextContent("- old two");
    expect(diff.querySelector('[data-kind="add"]')).toHaveTextContent("+ line two");
  });

  it("says when the two bodies are the same", async () => {
    setup("same", "same");
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    await screen.findByTestId("agent-skill-body-plain");
    await user.click(screen.getByRole("button", { name: T.diffButton }));
    expect(await screen.findByTestId("diff-same")).toHaveTextContent(T.diffSame);
  });

  it("shows an error when the Agent Skill cannot load", async () => {
    m.versions.mockResolvedValue({ ok: false, error: "No such Agent Skill." });
    m.get.mockResolvedValue({ ok: false, error: "No such Agent Skill." });
    render(<AgentSkillDetail name="gone" />);
    expect(await screen.findByText("No such Agent Skill.")).toBeInTheDocument();
  });
});

describe("grants on the detail page", () => {
  function detailMocks() {
    m.versions.mockResolvedValue({ ok: true, data: [entry()] });
    m.get.mockResolvedValue({ ok: true, data: { entry: entry(), body: "b", files: [] } });
  }

  it("lists the present grants and revokes one", async () => {
    detailMocks();
    m.grants.mockResolvedValue({
      ok: true,
      data: [
        { kind: "agent", subjectId: "agent-1" },
        { kind: "mission", subjectId: "m-1" },
      ],
    });
    m.revoke.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    const rows = await screen.findAllByTestId("grant-row");
    expect(rows).toHaveLength(2);
    await user.click(within(rows[0]).getByRole("button", { name: `${T.revokeButton} agent-1` }));
    expect(m.revoke).toHaveBeenCalledWith({
      name: "triage",
      subjectKind: "agent",
      subjectId: "agent-1",
    });
    await waitFor(() => expect(m.grants.mock.calls.length).toBeGreaterThan(1));
  });

  it("states that no grant exists", async () => {
    detailMocks();
    render(<AgentSkillDetail name="triage" />);
    expect(await screen.findByTestId("grants-empty")).toHaveTextContent(T.grantsEmpty);
  });

  it("grants to an agent that the picker lists", async () => {
    detailMocks();
    m.agents.mockResolvedValue({ ok: true, data: [{ id: "agent-9", name: "Scout" }] });
    m.grant.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    await screen.findByRole("option", { name: "Scout (agent-9)" });
    await user.selectOptions(screen.getByLabelText(T.fieldSubjectPick), "agent-9");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(m.grant).toHaveBeenCalledWith({
      name: "triage",
      subjectKind: "agent",
      subjectId: "agent-9",
    });
  });

  it("picks a mission, and falls back to a text field when the lists are empty", async () => {
    detailMocks();
    m.missions.mockResolvedValue({ ok: true, data: [{ id: "m-7", name: "Recon" }] });
    m.grant.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    // No agent is listed, so the agent form starts with the text field.
    expect(await screen.findByLabelText(T.fieldSubjectId)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(T.fieldSubjectKind), "mission");
    await user.selectOptions(await screen.findByLabelText(T.fieldSubjectPick), "m-7");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(m.grant).toHaveBeenCalledWith({
      name: "triage",
      subjectKind: "mission",
      subjectId: "m-7",
    });
  });

  it("lets the admin type an id when a list exists", async () => {
    detailMocks();
    m.agents.mockResolvedValue({ ok: true, data: [{ id: "agent-9", name: "Scout" }] });
    m.grant.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    await screen.findByRole("option", { name: "Scout (agent-9)" });
    await user.click(screen.getByRole("button", { name: T.pickerEnterId }));
    await user.type(screen.getByLabelText(T.fieldSubjectId), "agent-x");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(m.grant).toHaveBeenCalledWith({
      name: "triage",
      subjectKind: "agent",
      subjectId: "agent-x",
    });
  });

  it("shows the error of a refused grant as text", async () => {
    detailMocks();
    m.grant.mockResolvedValue({ ok: false, error: "No such agent.", code: "not_found" });
    const user = userEvent.setup();
    render(<AgentSkillDetail name="triage" />);
    await user.type(await screen.findByLabelText(T.fieldSubjectId), "zz");
    await user.click(screen.getByRole("button", { name: T.grantButton }));
    expect(await screen.findByTestId("grant-error")).toHaveTextContent("No such agent.");
  });
});
