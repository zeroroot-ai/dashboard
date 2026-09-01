/**
 * Sign-in relay tests (gibson#1706 lane E2) with a mocked stream: the URL
 * with a copy button, the code prompt and submit, done and error, and the
 * owner-only visibility on the bank page.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as React from "react";

import { SignInAction } from "../SignInPanel";
import { useSignInRelay } from "@/src/hooks/useSignInRelay";
import type { MemberView } from "@/src/lib/banks/view";

// A fake EventSource the hook opens; tests push frames into it.
class FakeSource {
  listeners = new Map<string, (e: MessageEvent<string>) => void>();
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, fn);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}
let sources: FakeSource[] = [];
const openSource = (url: string) => {
  const s = new FakeSource(url);
  sources.push(s);
  return s;
};

vi.mock("@/src/hooks/useSignInRelay", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/src/hooks/useSignInRelay")>();
  return {
    ...mod,
    useSignInRelay: (bankId: string, memberId: string) => mod.useSignInRelay(bankId, memberId, openSource),
  };
});

const fetchMock = vi.fn();
vi.mock("@/src/lib/api/fetch", () => ({ apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const member: MemberView = {
  id: "member-12345678", bankId: "bank-1", missionId: "", missionRunId: "", agentRunId: "", sandboxId: "",
  state: "needs_sign_in", jobsInFlight: 0, cap: 1, activeJobIds: [], claudeVersion: "", lastHeartbeat: null,
};

beforeEach(() => {
  sources = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: member }), { status: 200 }));
});

async function openAndStart() {
  render(<SignInAction bankId="bank-1" member={member} />);
  fireEvent.click(screen.getByTestId("member-sign-in"));
  fireEvent.click(await screen.findByTestId("sign-in-start"));
  await waitFor(() => expect(sources).toHaveLength(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/banks/bank-1/members/member-12345678/sign-in", { method: "POST" });
  return sources[0];
}

describe("SignInAction", () => {
  it("says the sign-in completes on claude.ai and the token never reaches ZeroRoot", () => {
    render(<SignInAction bankId="bank-1" member={member} />);
    fireEvent.click(screen.getByTestId("member-sign-in"));
    expect(screen.getByTestId("sign-in-panel")).toHaveTextContent("ZeroRoot never sees the token");
    expect(screen.getByTestId("sign-in-panel")).toHaveTextContent("claude.ai");
  });

  it("starts the flow, shows the URL as a link with a copy button, then the code prompt, then done", async () => {
    const src = await openAndStart();
    expect(src.url).toBe("/api/banks/bank-1/members/member-12345678/sign-in/events");
    expect(screen.getByTestId("sign-in-waiting")).toBeInTheDocument();

    act(() => src.emit("step", { url: "https://claude.ai/login?x=1", codePrompt: "", done: false, error: "" }));
    const link = await screen.findByTestId("sign-in-link");
    expect(link).toHaveAttribute("href", "https://claude.ai/login?x=1");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(screen.getByTestId("sign-in-copy")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-code-form")).toBeNull();

    act(() => src.emit("step", { url: "", codePrompt: "Paste the code from the browser", done: false, error: "" }));
    expect(await screen.findByTestId("sign-in-code-form")).toHaveTextContent("Paste the code from the browser");
    fireEvent.change(screen.getByTestId("sign-in-code"), { target: { value: "ABCD-1234" } });
    fireEvent.click(screen.getByTestId("sign-in-submit"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/banks/bank-1/members/member-12345678/sign-in/code",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "ABCD-1234" }) }),
      ),
    );

    act(() => src.emit("step", { url: "", codePrompt: "", done: true, error: "" }));
    expect(await screen.findByTestId("sign-in-done")).toBeInTheDocument();
    expect(src.closed).toBe(true);
  });

  it("shows the error the flow reports and offers to sign in again", async () => {
    const src = await openAndStart();
    act(() => src.emit("step", { url: "", codePrompt: "", done: false, error: "The code was refused." }));
    expect(await screen.findByTestId("sign-in-error")).toHaveTextContent("The code was refused.");
    fireEvent.click(screen.getByTestId("sign-in-retry"));
    await waitFor(() => expect(sources).toHaveLength(2));
  });

  it("shows the daemon refusal when the start call fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "permission denied" } }), { status: 403 }));
    render(<SignInAction bankId="bank-1" member={member} />);
    fireEvent.click(screen.getByTestId("member-sign-in"));
    fireEvent.click(await screen.findByTestId("sign-in-start"));
    expect(await screen.findByTestId("sign-in-error")).toHaveTextContent("permission denied");
    expect(sources).toHaveLength(0);
  });

  it("writes nothing from the stream to browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const src = await openAndStart();
    act(() => src.emit("step", { url: "https://claude.ai/login?x=1", codePrompt: "", done: false, error: "" }));
    await screen.findByTestId("sign-in-link");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe("useSignInRelay phases", () => {
  it("moves idle, starting, waiting_url, open_url, code, done", async () => {
    const phases: string[] = [];
    function Probe() {
      const relay = useSignInRelay("b", "m", openSource);
      phases.push(relay.phase);
      return <button onClick={() => void relay.start()}>go</button>;
    }
    render(<Probe />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(sources).toHaveLength(1));
    act(() => sources[0].emit("step", { url: "u", codePrompt: "", done: false, error: "" }));
    act(() => sources[0].emit("step", { url: "", codePrompt: "p", done: false, error: "" }));
    act(() => sources[0].emit("step", { url: "", codePrompt: "", done: true, error: "" }));
    await waitFor(() => expect(phases.at(-1)).toBe("done"));
    expect([...new Set(phases)]).toEqual(["idle", "starting", "waiting_url", "open_url", "code", "done"]);
  });
});
