// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Tests for the public invitation accept page (/invite/<token>).
 *
 * This file exists because of a bug that shipped and survived two releases
 * without a single failing test (dashboard#166).
 *
 * AcceptInvitation mints a one-time Zitadel setup link with `returnCode`,
 * never `sendCode`, so the identity service emails NOTHING and the RPC
 * response is the only place that link ever appears. The page received it,
 * discarded it, and told the invitee to "check your email for a message from
 * the Gibson identity service" — mail that is never sent. An invited person
 * therefore had an active membership, no credential, and nothing to click.
 *
 * Nothing caught it. The identity exit test (hosted `test/identity/
 * exit-test-identity.sh`) calls MembershipService/AcceptInvitation directly
 * over gRPC, reads `setupUrl` out of the RPC response and drives that link
 * itself — it never loads this page. So the drill asserted the daemon returns
 * a link while the page threw it away, and stayed green throughout. The
 * assertion that was missing is the one this file makes: the page puts the
 * returned link in front of the person.
 *
 * Behavioral properties under test:
 *
 *   A) On a successful accept, the setup link the action returned is rendered
 *      as the primary action's href. This is the regression guard.
 *   B) The page never tells the invitee to wait for email. No message is sent,
 *      so that instruction is a dead end whatever else the page does.
 *   C) An external anchor, not a client-side route: the setup flow is the
 *      identity provider's own hosted page on another origin, so a next/link
 *      would 404 on this app.
 *   D) An empty setup_url (an upstream mint failure) names the next move —
 *      a resend — rather than showing a dead end. The invitation is already
 *      redeemed by then, so "try again" is wrong.
 *   E) A refused redeem reaches the unavailable state and offers no link.
 *   F) The token is redeemed exactly once, even though React strict mode
 *      double-invokes effects.
 *
 * Strategy: mock the server action, render the client page, assert on rendered
 * output. No cluster and no daemon — the full-stack half of this flow is
 * dashboard#149.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

const SETUP_URL = "https://app.example.com/ui/v2/login/verify?userId=42&code=AB12CD&invite=true&organization=7";

const mockAccept = vi.fn();
vi.mock("@/app/actions/crd/member", () => ({
  acceptInvitationAction: (input: { token: string }) => mockAccept(input),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "raw-token" }),
}));

// next/link renders a plain anchor so hrefs are assertable either way; the
// test for property C distinguishes them by which element the href sits on.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, "data-next-link": "true" }, children),
}));

import InviteAcceptPage from "../page";

beforeEach(() => {
  mockAccept.mockReset();
  mockAccept.mockResolvedValue({ ok: true, data: { setupUrl: SETUP_URL } });
});

describe("the invitation accept page", () => {
  it("A) renders the returned setup link as the primary action", async () => {
    render(<InviteAcceptPage />);
    const link = await screen.findByRole("link", { name: /set your password/i });
    expect(link).toHaveAttribute("href", SETUP_URL);
  });

  it("B) never tells the invitee to wait for an email", async () => {
    render(<InviteAcceptPage />);
    await screen.findByRole("link", { name: /set your password/i });
    const body = document.body.textContent ?? "";
    for (const deadEnd of [
      /check your email/i,
      /identity service/i,
      /another email/i,
      /second email/i,
    ]) {
      expect(body).not.toMatch(deadEnd);
    }
  });

  it("C) points at the setup flow with an external anchor, not a client route", async () => {
    render(<InviteAcceptPage />);
    const link = await screen.findByRole("link", { name: /set your password/i });
    // A next/link would carry the marker from the mock above. The setup page
    // lives on the identity provider's origin, so this must be a plain anchor.
    expect(link).not.toHaveAttribute("data-next-link");
  });

  it("D) names the next move when the mint failed and no link came back", async () => {
    mockAccept.mockResolvedValue({ ok: true, data: { setupUrl: "" } });
    render(<InviteAcceptPage />);
    expect(screen.queryByRole("link", { name: /set your password/i })).toBeNull();
    // One matcher, not two: "membership is active" appears in both the success
    // heading and this paragraph, so a loose match finds two elements and
    // throws. Assert the sentence that is unique to this branch, which also
    // carries the whole intent — the membership stands, the link did not.
    expect(
      await screen.findByText(/membership is active, but we could not create your password/i),
    ).toBeInTheDocument();
    expect(await screen.findByText(/resend the invitation/i)).toBeInTheDocument();
  });

  it("E) reaches the unavailable state on a refused redeem, with no link", async () => {
    mockAccept.mockResolvedValue({ ok: false, error: "nope", code: "FORBIDDEN" });
    render(<InviteAcceptPage />);
    // Same trap as above: the title and the body both carry the idea, so match
    // the body sentence, which only this branch renders.
    expect(
      await screen.findByText(/this invitation can't be accepted/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /set your password/i })).toBeNull();
    expect(screen.queryByText(/membership is active/i)).toBeNull();
  });

  it("F) redeems the token exactly once under a double-invoked effect", async () => {
    render(
      <React.StrictMode>
        <InviteAcceptPage />
      </React.StrictMode>,
    );
    await screen.findByRole("link", { name: /set your password/i });
    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith({ token: "raw-token" });
  });
});
