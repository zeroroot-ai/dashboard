// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { publish, names } = vi.hoisted(() => ({ publish: vi.fn(), names: vi.fn() }));
vi.mock("@/app/actions/agent-skills", () => ({ publishAgentSkillAction: publish }));
vi.mock("@/app/actions/read/listSecretNames", () => ({ listSecretNamesAction: names }));

import { PublishAgentSkillForm } from "../PublishAgentSkillForm";
import { AGENT_SKILL_TEXT as T } from "../texts";

beforeEach(() => {
  publish.mockReset();
  names.mockReset().mockResolvedValue({ ok: true, data: ["reg-cred", "other"] });
});

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(T.fieldName), "triage");
  await user.type(screen.getByLabelText(T.fieldReference), "reg.example/t/triage@sha256:aa");
}

describe("PublishAgentSkillForm", () => {
  it("offers the tenant secrets as the registry secret", async () => {
    render(<PublishAgentSkillForm onPublished={vi.fn()} />);
    expect(await screen.findByRole("option", { name: "reg-cred" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: T.registrySecretNone })).toBeInTheDocument();
  });

  it("still works when the secret list fails", async () => {
    names.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    publish.mockResolvedValue({ ok: true, data: null });
    const done = vi.fn();
    render(<PublishAgentSkillForm onPublished={done} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it("sends the fields and reports the publish", async () => {
    const user = userEvent.setup();
    publish.mockResolvedValue({ ok: true, data: { name: "triage" } });
    const done = vi.fn();
    render(<PublishAgentSkillForm onPublished={done} />);
    await screen.findByRole("option", { name: "reg-cred" });
    await fill(user);
    await user.selectOptions(screen.getByLabelText(T.fieldRegistrySecret), "reg-cred");
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith({
        name: "triage",
        reference: "reg.example/t/triage@sha256:aa",
        registrySecret: "reg-cred",
      }),
    );
    expect(done).toHaveBeenCalledWith({ name: "triage" }, "triage");
  });

  it("shows the error of the daemon as text and keeps the input", async () => {
    const user = userEvent.setup();
    publish.mockResolvedValue({
      ok: false,
      error: "SKILL.md: the name does not match the folder",
      code: "invalid_argument",
    });
    const done = vi.fn();
    render(<PublishAgentSkillForm onPublished={done} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: T.publishButton }));
    expect(await screen.findByTestId("publish-error")).toHaveTextContent(
      "SKILL.md: the name does not match the folder",
    );
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByLabelText(T.fieldName)).toHaveValue("triage");
  });
});
