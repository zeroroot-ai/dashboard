"use client";

/**
 * /invite/<token> — public invitation accept page (dashboard#727).
 *
 * The invitee (typically brand-new, no session) lands here from the accept link
 * emailed by the daemon (gibson#632). On load it redeems the token via
 * acceptInvitationAction → MembershipService.AcceptInvitation: the daemon
 * provisions the member (FGA tuple + Zitadel org membership) and triggers the
 * identity service's credential-setup email. The token is the sole capability —
 * no dashboard session required (the page lives outside the /dashboard
 * auth-gated prefix; the server action calls the daemon as the dashboard SA).
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
  | { kind: "accepted" }
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
        setState({ kind: "accepted" });
      } else {
        setState({
          kind: "error",
          message:
            "This invitation can't be accepted. The link may have expired, been cancelled, or already been used.",
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
              <p className="text-sm text-muted-foreground">
                Check your email for a message from the Gibson identity service to
                set your password, then sign in.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Continue to sign in</Link>
              </Button>
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
