/**
 * JobNodeDialog tests (gibson#1706 lane E4): the pickers list banks,
 * connectors, verifiers and secret names; validation mirrors OpenJob; the
 * round trip feeds the form from a stored node and emits the same values.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { JobNodeDialog } from "../job-node-dialog";
import type { JobNodeFormValues } from "@/src/lib/mission/job-node";

vi.mock("@/src/hooks/useBanks", () => ({
  useBanks: () => ({
    data: [
      { id: "b2", name: "other-crew", owner: { kind: "user", id: "u9" } },
      { id: "b1", name: "fix-crew", owner: { kind: "user", id: "u1" } },
    ],
  }),
}));
vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({ data: { user: { id: "u1", email: "u@x" } }, isPending: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/src/lib/tenant-context", () => ({
  useTenantContext: () => ({ currentTenant: { id: "t1" }, rolesByTenant: { t1: "member" } }),
}));
vi.mock("@/app/actions/connectors", () => ({
  listConnectorsAction: vi.fn(async () => ({ ok: true, data: { catalog: [], enabled: [{ id: "gitlab", shape: "oauth", runtime: "remote", phase: "Ready", discoveredTools: 3, lastError: "" }] } })),
}));
vi.mock("@/app/actions/read/listAccessibleComponents", () => ({
  listAccessibleComponentsAction: vi.fn(async () => ({
    ok: true,
    data: [
      { name: "verifier", kind: "agent", rwx: { read: true, write: false, execute: true } },
      { name: "semgrep", kind: "tool", rwx: { read: true, write: false, execute: true } },
      { name: "locked", kind: "agent", rwx: { read: true, write: false, execute: false } },
      { name: "gitlab", kind: "connector", rwx: { read: true, write: false, execute: true } },
    ],
  })),
}));
vi.mock("@/app/actions/read/listSecretNames", () => ({
  listSecretNamesAction: vi.fn(async () => ({ ok: true, data: ["npm-token"] })),
}));

function renderDialog(initial?: JobNodeFormValues) {
  const onInsert = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <JobNodeDialog open onOpenChange={() => undefined} initial={initial} onInsert={onInsert} />
    </QueryClientProvider>,
  );
  return { onInsert };
}

function openSelect(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(trigger);
}

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

describe("JobNodeDialog", () => {
  it("lists banks with the ones I own first, and marks the rest", async () => {
    renderDialog();
    openSelect("job-node-bank");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["fix-crew", "other-crew (needs can_send)"]);
  });

  it("lists executable agents and tools as verifiers in the slash form, and secret names as a typeahead", async () => {
    renderDialog();
    await waitFor(() => expect(document.querySelector("#job-node-secret-names option")).not.toBeNull());
    expect(document.querySelector('#job-node-secret-names option[value="npm-token"]')).not.toBeNull();
    openSelect("job-node-verifier");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["None: a person closes the job", "agent/verifier", "tool/semgrep"]);
  });

  it("refuses to insert without a bank and a goal, and shows the errors", async () => {
    const { onInsert } = renderDialog();
    fireEvent.click(screen.getByTestId("job-node-insert"));
    expect(await screen.findByText("A bank is required")).toBeInTheDocument();
    expect(screen.getByText("Say what the job must achieve")).toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("inserts a node with a repository from the connector picker", async () => {
    const { onInsert } = renderDialog();
    openSelect("job-node-bank");
    fireEvent.click(await screen.findByTestId("bank-option-fix-crew"));
    fireEvent.change(screen.getByTestId("job-node-goal"), { target: { value: "Fix the findings." } });
    fireEvent.click(screen.getByTestId("job-node-add-repo"));
    await waitFor(() => expect(screen.getByTestId("job-node-repo")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("app"), { target: { value: "app" } });
    fireEvent.change(screen.getByPlaceholderText("group/repo"), { target: { value: "acme/app" } });
    // The connector select defaults to the first enabled connector.
    await waitFor(() => expect(screen.getByTestId("job-node-connector")).toHaveTextContent("connector/gitlab"));
    fireEvent.change(screen.getByTestId("job-node-credentials"), { target: { value: "npm-token, pypi-token" } });
    fireEvent.change(screen.getByTestId("job-node-inputs"), { target: { value: "scan" } });
    openSelect("job-node-verifier");
    fireEvent.click(await screen.findByTestId("verifier-option-agent/verifier"));
    fireEvent.click(screen.getByTestId("job-node-insert"));
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    const v = onInsert.mock.calls[0][0] as JobNodeFormValues;
    expect(v).toMatchObject({
      nodeId: "fix",
      bankRef: "fix-crew",
      goal: "Fix the findings.",
      credentialNames: ["npm-token", "pypi-token"],
      inputs: ["scan"],
      verifierComponent: "agent/verifier",
      passingScore: 0.8,
      maxPasses: 3,
    });
    expect(v.repositories).toEqual([{ name: "app", connectorRef: "connector/gitlab", project: "acme/app", baseBranch: "", deliverable: "merge_request" }]);
  });

  it("round trip: a stored node feeds the form and inserts the same values", async () => {
    const stored: JobNodeFormValues = {
      nodeId: "fix", name: "Fix", bankRef: "fix-crew", goal: "g",
      repositories: [{ name: "app", connectorRef: "connector/gitlab", project: "acme/app", baseBranch: "main", deliverable: "push_branch" }],
      credentialNames: ["npm-token"], inputs: ["scan"], verifierComponent: "tool/semgrep",
      passingScore: 0.9, maxPasses: 2, maxTurns: 10, maxTokens: 0, deadlineMinutes: 30,
    };
    const { onInsert } = renderDialog(stored);
    expect(screen.getByTestId("job-node-goal")).toHaveValue("g");
    expect(screen.getByTestId("job-node-credentials")).toHaveValue("npm-token");
    expect(screen.getByTestId("job-node-bank")).toHaveTextContent("fix-crew");
    fireEvent.click(screen.getByTestId("job-node-insert"));
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    expect(onInsert.mock.calls[0][0]).toEqual(stored);
  });
});
