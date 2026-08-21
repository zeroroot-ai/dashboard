"use client";

/**
 * ConnectorAuthCard
 *
 * The vendor-authorization panel on a connector's detail page (ADR-0064,
 * dashboard#1093). Shows whether the connector holds a working OAuth grant,
 * WHO authorized it — a connector is a service account with an audit trail in
 * front of it, and "who is this connector acting as" must have an answer on
 * screen — and drives the three operator actions:
 *
 *  - Authorize / Re-authorize: collects the vendor instance URL (and an
 *    optional application ID for instances without dynamic client
 *    registration), then hands the browser to the vendor's authorize page.
 *    The operator returns via the OAuth callback route.
 *  - Revoke: revokes at the vendor and deletes the grant, which stops every
 *    agent using the connector.
 *
 * Rendered only for connectors (runtime `mcp-bridge`); a plain plugin has no
 * vendor to authorize against.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangleIcon,
  KeyRoundIcon,
  Loader2Icon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  beginConnectorAuthorizationAction,
  getConnectorAuthStatusAction,
  revokeConnectorGrantAction,
  type ConnectorAuthStatusView,
} from "@/app/actions/connector-auth";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

/** The GitLab MCP server's scope. The one vendor shipped so far. */
const DEFAULT_SCOPE = "mcp";

function formatIso(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "-";
  }
}

function AuthStateBadge({ state }: { state: string }) {
  switch (state) {
    case "authorized":
      return (
        <Badge variant="outline" className="text-highlight">
          <ShieldCheckIcon className="mr-1 size-3" aria-hidden="true" />
          Authorized
        </Badge>
      );
    case "refresh_failing":
      return (
        <Badge variant="outline" className="text-destructive">
          <AlertTriangleIcon className="mr-1 size-3" aria-hidden="true" />
          Refresh failing
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <ShieldOffIcon className="mr-1 size-3" aria-hidden="true" />
          Not authorized
        </Badge>
      );
  }
}

interface ConnectorAuthCardProps {
  installId: string;
  /** The connector component name, e.g. "connector-gitlab". */
  connector: string;
}

export function ConnectorAuthCard({ installId, connector }: ConnectorAuthCardProps) {
  const [status, setStatus] = useState<ConnectorAuthStatusView | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState("https://gitlab.com");
  const [clientId, setClientId] = useState("");
  const [beginning, setBeginning] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const { allowed: canManage, loading: authzLoading } = useAuthorize(
    "/gibson.tenant.v1.ConnectorAuthService/CompleteConnectorAuthorization",
  );
  const showManage = !authzLoading && canManage;

  const searchParams = useSearchParams();

  const refresh = useCallback(async () => {
    const result = await getConnectorAuthStatusAction({ connector });
    if (result.ok) {
      setStatus(result.data);
      setStatusError(null);
    } else {
      setStatusError(result.error);
    }
    setLoading(false);
  }, [connector]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The callback route lands back here with ?connector_auth=ok|error|expired.
  // One toast per landing; the flag stays in the URL (harmless) rather than
  // pulling in router juggling.
  useEffect(() => {
    const outcome = searchParams.get("connector_auth");
    if (!outcome) return;
    if (outcome === "ok") {
      toast.success("Connector authorized");
    } else if (outcome === "expired") {
      toast.error("The authorization session expired. Start again.");
    } else {
      toast.error(
        searchParams.get("connector_auth_detail") || "Authorization failed",
      );
    }
    // Re-read the status the callback just changed.
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleBegin() {
    setBeginning(true);
    const result = await beginConnectorAuthorizationAction({
      installId,
      connector,
      instanceUrl: instanceUrl.trim(),
      scope: DEFAULT_SCOPE,
      clientId: clientId.trim() || undefined,
    });
    if (result.ok) {
      // Top-level navigation to the vendor's authorize page; the operator
      // comes back through the callback route.
      window.location.assign(result.data.authorizeUrl);
      return;
    }
    toast.error(result.error);
    setBeginning(false);
  }

  async function handleRevoke() {
    setRevoking(true);
    const result = await revokeConnectorGrantAction({ connector, installId });
    if (result.ok) {
      toast.success(
        result.data.vendorRevoked
          ? "Grant revoked, including at the instance"
          : "Grant revoked on the platform",
      );
      await refresh();
    } else {
      toast.error(result.error);
    }
    setRevoking(false);
  }

  const authorized = status !== null && status.state !== "unauthorized";

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <KeyRoundIcon className="size-4" aria-hidden="true" />
              Vendor authorization
            </CardTitle>
            <CardDescription className="text-xs">
              The OAuth grant this connector presents to its vendor. The
              platform keeps the credential fresh; agents never hold it.
            </CardDescription>
          </div>
          {!loading && status && <AuthStateBadge state={status.state} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {loading ? (
          <p className="text-muted-foreground text-xs">
            <Loader2Icon
              className="mr-1 inline size-3 animate-spin"
              aria-hidden="true"
            />
            Loading authorization status…
          </p>
        ) : statusError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" aria-hidden="true" />
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription className="text-xs">{statusError}</AlertDescription>
          </Alert>
        ) : status ? (
          <>
            {status.state === "refresh_failing" && (
              <Alert variant="destructive">
                <AlertTriangleIcon className="size-4" aria-hidden="true" />
                <AlertTitle>Token refresh is failing</AlertTitle>
                <AlertDescription className="text-xs">
                  {status.lastRefreshError ||
                    "The vendor refused the last refresh."}{" "}
                  Re-authorize to restore access, or revoke if this connector
                  should lose it.
                </AlertDescription>
              </Alert>
            )}

            {authorized ? (
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground mb-0.5 font-medium">
                    Authorized by
                  </p>
                  <p>
                    {status.authorizedByDisplay || (
                      <code className="bg-muted rounded px-1 font-mono">
                        {status.authorizedBy}
                      </code>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 font-medium">
                    Authorized at
                  </p>
                  <p>{formatIso(status.authorizedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 font-medium">Scope</p>
                  <p className="font-mono">{status.scope || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 font-medium">
                    Access token expires
                  </p>
                  <p>{formatIso(status.accessTokenExpiresAt)}</p>
                </div>
                {status.lastRefreshAt && (
                  <div>
                    <p className="text-muted-foreground mb-0.5 font-medium">
                      Last refresh
                    </p>
                    <p>{formatIso(status.lastRefreshAt)}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                This connector has no vendor grant. Until an operator
                authorizes it, every call to the vendor will be refused.
              </p>
            )}
          </>
        ) : null}

        {showManage && (
          <div className="flex items-center gap-2 pt-1">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant={authorized ? "outline" : "default"}>
                  {authorized ? "Re-authorize" : "Authorize"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Authorize {connector}</DialogTitle>
                  <DialogDescription>
                    You will be sent to your instance to sign in and consent.
                    The authorization is recorded under your name, and the
                    resulting credential is held by the platform, never by
                    agents.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="connector-instance-url">Instance URL</Label>
                    <Input
                      id="connector-instance-url"
                      type="url"
                      value={instanceUrl}
                      onChange={(e) => setInstanceUrl(e.target.value)}
                      placeholder="https://gitlab.example.com"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="connector-client-id">
                      Application ID{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="connector-client-id"
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="Only needed when the instance disallows automatic app registration"
                      autoComplete="off"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    onClick={() => void handleBegin()}
                    disabled={beginning || !instanceUrl.trim()}
                  >
                    {beginning && (
                      <Loader2Icon
                        className="mr-1 size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    Continue to instance
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {authorized && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={revoking}
                  >
                    {revoking && (
                      <Loader2Icon
                        className="mr-1 size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    Revoke
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke this connector&apos;s access?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The grant is revoked at the instance and deleted from the
                      platform. Every agent using this connector loses access
                      until someone re-authorizes it.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleRevoke()}>
                      Revoke access
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
