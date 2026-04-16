"use client";

/**
 * /invite/accept — Invitation acceptance page
 *
 * Reads the `token` query parameter, calls AcceptInvitation on the daemon,
 * and redirects the user to the Better Auth set-password flow.
 *
 * Error handling:
 *   FAILED_PRECONDITION (code 9) → token expired
 *   ALREADY_EXISTS (code 6)      → already accepted
 *   INVALID_ARGUMENT (code 3)    → invalid token
 *   anything else                 → generic error
 *
 * Requirements: 8.3, 8.5
 */

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ConnectError, Code } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { DaemonAdminService } from "@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb";
import { Loader2, CheckCircle, AlertCircle, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AcceptState =
  | { status: "loading" }
  | { status: "success"; tenantId: string }
  | { status: "expired" }
  | { status: "consumed" }
  | { status: "invalid" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getAdminClient() {
  const baseUrl = process.env["NEXT_PUBLIC_GIBSON_DAEMON_URL"] ?? "";
  const transport = createGrpcWebTransport({ baseUrl });
  return createClient(DaemonAdminService, transport);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get("token") ?? "";

  const [state, setState] = React.useState<AcceptState>({ status: "loading" });

  React.useEffect(() => {
    if (!token) {
      setState({ status: "invalid" });
      return;
    }

    let cancelled = false;

    async function accept() {
      try {
        const client = getAdminClient();
        const resp = await client.acceptInvitation({ token });

        if (!cancelled) {
          setState({ status: "success", tenantId: resp.tenantId });

          // Redirect to login after a short delay so the user sees the success
          // state, then can sign in to access their new workspace.
          setTimeout(() => {
            if (!cancelled) {
              router.push("/dashboard/login/v2");
            }
          }, 2_000);
        }
      } catch (err) {
        if (cancelled) return;

        if (err instanceof ConnectError) {
          switch (err.code) {
            case Code.FailedPrecondition:
              setState({ status: "expired" });
              break;
            case Code.AlreadyExists:
              setState({ status: "consumed" });
              break;
            case Code.InvalidArgument:
              setState({ status: "invalid" });
              break;
            default:
              setState({ status: "error", message: "An unexpected error occurred." });
          }
        } else {
          setState({ status: "error", message: "An unexpected error occurred." });
        }
      }
    }

    void accept();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderContent() {
    switch (state.status) {
      case "loading":
        return (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-mono">Validating invitation...</p>
          </div>
        );

      case "success":
        return (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle className="size-12 text-green-500" />
            <h2 className="text-lg font-bold font-mono text-glow-green">
              Welcome aboard!
            </h2>
            <p className="text-sm text-muted-foreground text-center">
              Your invitation has been accepted. Redirecting you to set your
              password...
            </p>
          </div>
        );

      case "expired":
        return (
          <div className="flex flex-col items-center gap-4">
            <Clock className="size-12 text-yellow-500" />
            <h2 className="text-lg font-bold font-mono">Invitation Expired</h2>
            <p className="text-sm text-muted-foreground text-center">
              This invitation has expired. Please ask your workspace admin to
              send a new invitation.
            </p>
          </div>
        );

      case "consumed":
        return (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle className="size-12 text-muted-foreground" />
            <h2 className="text-lg font-bold font-mono">Already Accepted</h2>
            <p className="text-sm text-muted-foreground text-center">
              This invitation has already been accepted.
            </p>
            <Button asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        );

      case "invalid":
        return (
          <div className="flex flex-col items-center gap-4">
            <XCircle className="size-12 text-destructive" />
            <h2 className="text-lg font-bold font-mono">Invalid Invitation</h2>
            <p className="text-sm text-muted-foreground text-center">
              This invitation token is not valid. Please check the link and try
              again, or contact your workspace admin.
            </p>
          </div>
        );

      case "error":
        return (
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="size-12 text-destructive" />
            <h2 className="text-lg font-bold font-mono">Something Went Wrong</h2>
            <p className="text-sm text-muted-foreground text-center">
              {state.message}
            </p>
          </div>
        );
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight font-mono text-glow-green">
            Gibson
          </h1>
          <p className="text-sm text-muted-foreground">Workspace Invitation</p>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}
