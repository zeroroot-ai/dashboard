// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * /invite/<token>, public invitation accept page (dashboard#727).
 *
 * The invitee (typically brand-new, no session) lands here from the accept link
 * carried by the daemon's invitation email (gibson#632). On load it redeems the
 * token via acceptInvitationAction → MembershipService.AcceptInvitation: the
 * daemon provisions the member (FGA tuple + Zitadel org membership) and mints a
 * one-time setup link. The token is the sole capability - no dashboard session
 * required (the page lives outside the /dashboard auth-gated prefix; the server
 * action calls the daemon as the dashboard SA).
 *
 * This page hands over the setup link, and that is the fix it exists for. The
 * link is minted with `returnCode`, never `sendCode`, so the identity service
 * emails nothing. The page used to drop the link and tell the invitee to check
 * their email for a message from the identity service - mail that is never
 * sent - so an invited person had no way to set a password and no way to sign
 * in. The link is single-use, carries no password, and is only reachable by the
 * browser that just redeemed the token, which is what proved mailbox control.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2Icon, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInvitationAction } from "@/app/actions/crd/member";

type State =
  | { kind: "accepting" }
  | { kind: "accepted"; setupUrl: string }
  | { kind: "error"; message: string };

export default function InviteAcceptPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : (params.token ?? "");
  const [state, setState] = useState<State>({ kind: "accepting" });
  // Guard against the effect firing twice under React strict mode.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState({ kind: "error", message: "This invitation link is missing its token." });
      return;
    }
    void (async () => {
      const res = await acceptInvitationAction({ token });
      if (res.ok) {
        setState({ kind: "accepted", setupUrl: res.data.setupUrl });
      } else {
        setState({
          kind: "error",
          message:
            "This invitation can't be accepted. The link may have expired, been canceled, or already been used.",
        });
      }
    })();
  }, [token]);

  return (
    <div className="mx-auto flex max-w-lg items-center justify-center p-8 lg:min-h-screen">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {state.kind === "accepting" && "Accepting your invitation…"}
            {state.kind === "accepted" && "You're in"}
            {state.kind === "error" && "Invitation unavailable"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.kind === "accepting" && (
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
              <span className="text-sm">Setting up your access…</span>
            </div>
          )}

          {state.kind === "accepted" && (
            <>
              <div className="flex items-center gap-3 text-highlight">
                <CheckCircle2 className="size-5" />
                <span className="text-sm font-medium">Your membership is active.</span>
              </div>
              {/*
                An external href, not next/link: the setup flow is the identity
                service's own hosted page, on another origin. A client-side
                route would 404 on this app.
              */}
              {state.setupUrl ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    One step left. Set a password and enroll a second factor. The link
                    below works once.
                  </p>
                  <Button asChild className="w-full">
                    <a href={state.setupUrl}>Set your password</a>
                  </Button>
                </>
              ) : (
                /*
                  Reachable only when the daemon returned an empty setup_url,
                  which means the mint failed upstream. Naming the next move
                  beats a dead end: the invitation is already redeemed, so a
                  resend is the way back to a working link.
                */
                <>
                  <p className="text-sm text-muted-foreground">
                    Your membership is active, but we could not create your password
                    setup link. Ask your workspace admin to resend the invitation.
                  </p>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/login">Go to sign in</Link>
                  </Button>
                </>
              )}
            </>
          )}

          {state.kind === "error" && (
            <>
              <div className="flex items-center gap-3 text-destructive">
                <XCircle className="size-5" />
                <span className="text-sm font-medium">{state.message}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Ask your workspace admin to send a fresh invitation.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
