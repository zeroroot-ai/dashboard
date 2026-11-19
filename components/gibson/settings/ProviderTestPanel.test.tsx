// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * ProviderTestPanel tests (dashboard#374, gibson#1394): the panel waits for the
 * route of a SAVED provider, then tests it. It sends the name and no
 * credential. A failed test leaves the saved provider.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { apiFetch, deleteMutate } = vi.hoisted(() => ({ apiFetch: vi.fn(), deleteMutate: vi.fn() }));
vi.mock("@/src/lib/api/fetch", () => ({ apiFetch }));
vi.mock("@/src/hooks/useProviderMutations", () => ({
  useDeleteProvider: () => ({ mutate: deleteMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProviderTestPanel } from "./ProviderTestPanel";

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}
const notReady = () => json({ result: { ok: false, errorClass: "route_not_ready" } });
const listed = () => json({ result: { ok: true, errorClass: "" } });
const testOk = () =>
  json({
    result: {
      ok: true,
      latencyMs: 42,
      model: "m1",
      models: [
        { name: "m1", contextWindow: 200000 },
        { name: "m2", contextWindow: 0 },
      ],
    },
  });

function urls(): string[] {
  return apiFetch.mock.calls.map((c) => String(c[0]));
}

function renderPanel(props: Partial<React.ComponentProps<typeof ProviderTestPanel>> = {}) {
  const onDone = vi.fn();
  const onRemoved = vi.fn();
  render(
    <ProviderTestPanel
      name="claude-prod"
      onDone={onDone}
      onRemoved={onRemoved}
      intervalMs={10}
      timeoutMs={5000}
      {...props}
    />,
  );
  return { onDone, onRemoved };
}

beforeEach(() => {
  apiFetch.mockReset();
  deleteMutate.mockReset();
});

describe("ProviderTestPanel", () => {
  it("shows the wait while the route is not ready, then tests and shows the models", async () => {
    apiFetch
      .mockResolvedValueOnce(notReady())
      .mockResolvedValueOnce(notReady())
      .mockResolvedValueOnce(listed())
      .mockResolvedValueOnce(testOk());
    renderPanel();
    expect(screen.getByTestId("route-waiting")).toBeInTheDocument();
    expect(await screen.findByTestId("test-passed")).toHaveTextContent("Connection test passed (42 ms)");
    expect(screen.getByText(/m1 \(200,000 ctx\)/)).toBeInTheDocument();
    expect(urls()).toEqual([
      "/api/settings/providers/claude-prod/models",
      "/api/settings/providers/claude-prod/models",
      "/api/settings/providers/claude-prod/models",
      "/api/settings/providers/test",
    ]);
  });

  it("shows a waiting state while a slow test call runs, and sets no client timeout of its own", async () => {
    let finish!: (v: unknown) => void;
    apiFetch.mockResolvedValueOnce(listed()).mockReturnValueOnce(new Promise((r) => (finish = r)));
    renderPanel();
    expect(await screen.findByTestId("test-running")).toHaveTextContent(/up to a minute/i);
    // The wait is longer than any timer of the panel: the call stays open.
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByTestId("test-running")).toBeInTheDocument();
    const testCall = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/providers/test"))!;
    // The only signal is the abort of an unmount. There is no timeout signal.
    expect(testCall[1].signal).toBeInstanceOf(AbortSignal);
    finish(testOk());
    expect(await screen.findByTestId("test-passed")).toBeInTheDocument();
  });

  it("sends the name of the saved provider and no credential to the test call", async () => {
    apiFetch.mockResolvedValueOnce(listed()).mockResolvedValueOnce(testOk());
    renderPanel();
    await screen.findByTestId("test-passed");
    const call = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/providers/test"))!;
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ name: "claude-prod" });
  });

  it("encodes the name in the path", async () => {
    apiFetch.mockResolvedValueOnce(listed()).mockResolvedValueOnce(testOk());
    renderPanel({ name: "a b/c" });
    await screen.findByTestId("test-passed");
    expect(urls()[0]).toBe("/api/settings/providers/a%20b%2Fc/models");
  });

  it("times out with a visible state and stops polling", async () => {
    apiFetch.mockResolvedValue(notReady());
    renderPanel({ intervalMs: 5, timeoutMs: 30 });
    expect(await screen.findByTestId("route-timeout")).toHaveTextContent(/route is not ready yet/i);
    const calls = apiFetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(apiFetch.mock.calls.length).toBe(calls);
    // The test endpoint was never called, because no route existed.
    expect(urls().every((u) => u.endsWith("/models"))).toBe(true);
  });

  it("leaves the saved provider after a failed test, with test again, done and remove", async () => {
    apiFetch
      .mockResolvedValueOnce(listed())
      .mockResolvedValueOnce(
        json({ result: { ok: false, latencyMs: 3, models: [], error: "the gateway or the provider refused the call" } }),
      );
    const { onDone } = renderPanel();
    const failed = await screen.findByTestId("test-failed");
    expect(failed).toHaveTextContent("the gateway or the provider refused the call");
    expect(failed).toHaveTextContent(/provider stays saved/i);
    expect(screen.getByRole("button", { name: /test again/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /remove provider/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(onDone).toHaveBeenCalled();
  });

  it("offers Edit after a failed test, opens the edit dialog, and tests again after a save", async () => {
    apiFetch
      .mockResolvedValueOnce(listed())
      .mockResolvedValueOnce(json({ result: { ok: false, latencyMs: 3, models: [], error: "bad key" } }))
      .mockResolvedValueOnce(listed())
      .mockResolvedValueOnce(testOk());
    renderPanel({
      renderEdit: (ctl) =>
        ctl.open ? (
          <div role="dialog" aria-label="edit credentials">
            <button type="button" onClick={ctl.onSaved}>
              save new credentials
            </button>
          </div>
        ) : null,
    });
    await screen.findByTestId("test-failed");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /edit credentials/i }));
    expect(screen.getByRole("dialog", { name: "edit credentials" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "save new credentials" }));
    expect(await screen.findByTestId("test-passed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit credentials/i })).toBeNull();
  });

  it("removes nothing when the person cancels the confirmation", async () => {
    apiFetch.mockResolvedValueOnce(listed()).mockResolvedValueOnce(testOk());
    const { onRemoved } = renderPanel();
    await screen.findByTestId("test-passed");
    await userEvent.click(screen.getByRole("button", { name: /remove provider/i }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Remove claude-prod?");
    expect(deleteMutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("tests again from the start", async () => {
    apiFetch
      .mockResolvedValueOnce(listed())
      .mockResolvedValueOnce(json({ result: { ok: false, latencyMs: 1, models: [], error: "boom" } }))
      .mockResolvedValueOnce(listed())
      .mockResolvedValueOnce(testOk());
    renderPanel();
    await screen.findByTestId("test-failed");
    await userEvent.click(screen.getByRole("button", { name: /test again/i }));
    expect(await screen.findByTestId("test-passed")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(4);
  });

  it("shows the error of a refused request as text", async () => {
    apiFetch.mockResolvedValueOnce(json({ error: { message: "Provider not found" } }, false, 404));
    renderPanel();
    expect(await screen.findByTestId("test-failed")).toHaveTextContent("Provider not found");
  });

  it("shows a failure when the network fails", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    renderPanel();
    expect(await screen.findByTestId("test-failed")).toHaveTextContent(/could not be reached/i);
  });

  it("removes the saved provider on request", async () => {
    apiFetch.mockResolvedValueOnce(listed()).mockResolvedValueOnce(testOk());
    deleteMutate.mockImplementation((_n: string, o: { onSuccess: () => void }) => o.onSuccess());
    const { onRemoved } = renderPanel();
    await screen.findByTestId("test-passed");
    await userEvent.click(screen.getByRole("button", { name: /remove provider/i }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(deleteMutate.mock.calls[0][0]).toBe("claude-prod");
  });

  it("stops polling when the panel unmounts", async () => {
    apiFetch.mockResolvedValue(notReady());
    const { unmount } = render(
      <ProviderTestPanel name="p" onDone={vi.fn()} onRemoved={vi.fn()} intervalMs={5} timeoutMs={5000} />,
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    unmount();
    const calls = apiFetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(apiFetch.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});
