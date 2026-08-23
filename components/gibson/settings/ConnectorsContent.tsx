"use client";
/**
 * ConnectorsContent
 *
 * The connectors settings panel (ADR-0014). A person browses the curated
 * catalog, enables a connector with one click, authorizes an OAuth connector by
 * approving once at the vendor, and sees the live status of every enabled
 * connector. The daemon does all the work; this panel reads and drives it
 * through the connectors API routes.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/src/lib/api/fetch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  CatalogEntryDTO as CatalogEntry,
  ConnectorDTO as Connector,
  ConnectorAuthDTO as ConnectorAuth,
} from "@/src/lib/gibson-client/connector-types";

interface ApiError {
  error?: { code?: string; message?: string };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read an error response once and report both whether it is an expired
 * session (HTTP 401, or a gRPC Unauthenticated mapped by
 * connectorErrorResponse to `error.code === "unauthenticated"`) and the
 * message to show otherwise.
 */
async function readEnableOrAuthorizeError(
  res: Response,
  fallback: string,
): Promise<{ sessionExpired: boolean; message: string }> {
  let code: string | undefined;
  let message = fallback;
  try {
    const body = (await res.json()) as ApiError;
    code = body.error?.code;
    message = body.error?.message ?? fallback;
  } catch {
    // Response wasn't JSON; fall back to the generic message.
  }
  return { sessionExpired: res.status === 401 || code === "unauthenticated", message };
}

/** Map a connector phase to a badge variant and a human label. */
function phaseBadge(phase: string): { variant: "success" | "secondary" | "outline" | "destructive"; label: string } {
  switch (phase) {
    case "Ready":
      return { variant: "success", label: "Ready" };
    case "AuthorizationRequired":
      return { variant: "outline", label: "Authorization required" };
    case "RefreshFailing":
      return { variant: "destructive", label: "Refresh failing" };
    case "Failed":
      return { variant: "destructive", label: "Failed" };
    default:
      return { variant: "secondary", label: phase || "Provisioning" };
  }
}

export function ConnectorsContent({ docsHref }: { docsHref: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);
  const [enabled, setEnabled] = React.useState<Connector[]>([]);
  const [auth, setAuth] = React.useState<Record<string, ConnectorAuth>>({});
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [disableTarget, setDisableTarget] = React.useState<Connector | null>(null);
  const [authTarget, setAuthTarget] = React.useState<{ id: string; displayName: string } | null>(null);
  const [instanceUrl, setInstanceUrl] = React.useState("");

  const setConnectorBusy = React.useCallback((id: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [id]: value }));
  }, []);

  const loadAuth = React.useCallback(async (connectorId: string) => {
    try {
      const res = await apiFetch(`/api/settings/connectors/${encodeURIComponent(connectorId)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { auth?: ConnectorAuth };
      if (body.auth) setAuth((prev) => ({ ...prev, [connectorId]: body.auth as ConnectorAuth }));
    } catch {
      // A failed status read is non-fatal; the card shows the phase regardless.
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/settings/connectors");
      if (!res.ok) {
        setLoadError(await readError(res, "The connector service is unavailable."));
        return;
      }
      const body = (await res.json()) as { catalog: CatalogEntry[]; enabled: Connector[] };
      setCatalog(body.catalog ?? []);
      setEnabled(body.enabled ?? []);
      await Promise.all(
        (body.enabled ?? [])
          .filter((c) => catalogAuthKind(body.catalog, c.id) === "oauth")
          .map((c) => loadAuth(c.id)),
      );
    } catch {
      setLoadError("The connector service could not be reached.");
    } finally {
      setLoading(false);
    }
  }, [loadAuth]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const enabledIds = React.useMemo(() => new Set(enabled.map((c) => c.id)), [enabled]);

  const notifySessionExpired = React.useCallback(() => {
    toast.error("Your session expired", {
      description: "Sign in again to continue.",
      action: { label: "Sign in", onClick: () => router.push("/login") },
    });
  }, [router]);

  async function onEnable(entry: CatalogEntry) {
    setConnectorBusy(entry.id, true);
    try {
      const res = await apiFetch("/api/settings/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalogId: entry.id }),
      });
      if (!res.ok) {
        const { sessionExpired, message } = await readEnableOrAuthorizeError(
          res,
          `Could not enable ${entry.displayName}.`,
        );
        if (sessionExpired) {
          notifySessionExpired();
        } else {
          toast.error(message);
        }
        return;
      }
      toast.success(`${entry.displayName} enabled.`);
      await load();
    } catch {
      toast.error(`Could not reach the service to enable ${entry.displayName}.`);
    } finally {
      setConnectorBusy(entry.id, false);
    }
  }

  function openAuthorize(connectorId: string, displayName: string) {
    setInstanceUrl("");
    setAuthTarget({ id: connectorId, displayName });
  }

  async function onAuthorize(connectorId: string, instanceUrl: string) {
    setConnectorBusy(connectorId, true);
    try {
      const res = await apiFetch(`/api/settings/connectors/${encodeURIComponent(connectorId)}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instanceUrl }),
      });
      if (!res.ok) {
        const { sessionExpired, message } = await readEnableOrAuthorizeError(
          res,
          "Could not start authorization.",
        );
        if (sessionExpired) {
          notifySessionExpired();
        } else {
          toast.error(message);
        }
        return;
      }
      const body = (await res.json()) as { authorizeUrl?: string };
      if (!body.authorizeUrl) {
        toast.error("The service did not return an authorization link.");
        return;
      }
      window.open(body.authorizeUrl, "_blank", "noopener,noreferrer");
      toast.info("Approve access in the tab that opened, then return here.");
      void pollAuth(connectorId);
    } catch {
      toast.error("Could not reach the service to start authorization.");
    } finally {
      setConnectorBusy(connectorId, false);
    }
  }

  const pollAuth = React.useCallback(
    async (connectorId: string) => {
      // Poll the grant status for up to five minutes while the human consents.
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        await loadAuth(connectorId);
        // Re-read from state via a fresh fetch each round is enough; the card
        // updates as soon as the state flips to authorized.
      }
      await load();
    },
    [loadAuth, load],
  );

  async function onRevoke(connectorId: string, displayName: string) {
    setConnectorBusy(connectorId, true);
    try {
      const res = await apiFetch(`/api/settings/connectors/${encodeURIComponent(connectorId)}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error(await readError(res, "Could not revoke the grant."));
        return;
      }
      toast.success(`Access revoked for ${displayName}.`);
      await loadAuth(connectorId);
    } catch {
      toast.error("Could not reach the service to revoke the grant.");
    } finally {
      setConnectorBusy(connectorId, false);
    }
  }

  async function onDisable(connector: Connector) {
    setConnectorBusy(connector.id, true);
    try {
      const res = await apiFetch(`/api/settings/connectors/${encodeURIComponent(connector.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(await readError(res, "Could not disable the connector."));
        return;
      }
      toast.success(`${connector.id} disabled.`);
      setDisableTarget(null);
      await load();
    } catch {
      toast.error("Could not reach the service to disable the connector.");
    } finally {
      setConnectorBusy(connector.id, false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A connector links an outside service to your agents&apos; tools. Enable one from the catalog,
          authorize it once with the vendor, and it goes live, its tools callable in every mission,
          attributed to the agent and to you.
        </p>
        {/* Docs are a separate deployable on their own host (dashboard#820), so
            this is a plain cross-origin anchor: next/link cannot route to it,
            and an RSC prefetch of a cross-origin URL dies on CORS (dashboard#963). */}
        <a
          href={docsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground mt-2 inline-block text-xs underline underline-offset-2 hover:text-foreground"
        >
          How connectors work
        </a>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The connector service is unavailable</AlertTitle>
          <AlertDescription>
            {loadError}
            <Button variant="outline" size="sm" className="mt-3 w-fit" onClick={() => void load()}>
              <RefreshCw /> Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="animate-spin" /> Loading connectors...
        </div>
      ) : null}

      {!loading && !loadError ? (
        <>
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-medium">Catalog</h2>
              <p className="text-muted-foreground text-sm">Curated connectors you can enable.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {catalog.map((entry) => {
                const already = enabledIds.has(entry.id);
                return (
                  <Card key={entry.id} className="border-border/60 bg-card/60 flex flex-col">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Plug className="size-4" /> {entry.displayName}
                        </CardTitle>
                        <div className="flex gap-1.5">
                          <Badge variant="outline" className="text-[10px] capitalize">{entry.shape}</Badge>
                          {entry.auth === "oauth" ? (
                            <Badge variant="secondary" className="text-[10px]">OAuth</Badge>
                          ) : null}
                        </div>
                      </div>
                      <CardDescription>{entry.description}</CardDescription>
                    </CardHeader>
                    <CardFooter className="mt-auto">
                      <Button
                        size="sm"
                        disabled={already || busy[entry.id]}
                        onClick={() => void onEnable(entry)}
                      >
                        {busy[entry.id] ? <Loader2 className="animate-spin" /> : null}
                        {already ? "Enabled" : "Enable"}
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-medium">Enabled</h2>
              <p className="text-muted-foreground text-sm">Connectors running for this workspace.</p>
            </div>
            {enabled.length === 0 ? (
              <Card className="border-border/60 bg-card/40 border-dashed">
                <CardContent className="text-muted-foreground py-10 text-center text-sm">
                  No connectors are enabled yet. Enable one from the catalog above.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {enabled.map((c) => {
                  const entry = catalog.find((e) => e.id === c.id);
                  const isOAuth = entry?.auth === "oauth";
                  const a = auth[c.id];
                  const badge = phaseBadge(c.phase);
                  return (
                    <Card key={c.id} className="border-border/60 bg-card/60">
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Plug className="size-4" /> {entry?.displayName ?? c.id}
                          </CardTitle>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
                            <Badge variant="outline" className="text-[10px] capitalize">{c.runtime}</Badge>
                            {c.discoveredTools > 0 ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {c.discoveredTools} tool{c.discoveredTools === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {c.phase === "Failed" && c.lastError ? (
                          <Alert variant="destructive">
                            <AlertCircle />
                            <AlertTitle>This connector failed to start</AlertTitle>
                            <AlertDescription>{c.lastError}</AlertDescription>
                          </Alert>
                        ) : null}

                        {isOAuth && a?.state === "refresh_failing" ? (
                          <Alert variant="destructive">
                            <ShieldAlert />
                            <AlertTitle>Access is expiring</AlertTitle>
                            <AlertDescription>
                              The saved access could not be refreshed
                              {a.lastRefreshError ? `: ${a.lastRefreshError}` : "."} Re-authorize to
                              restore it before it expires.
                              <Button
                                variant="outline"
                                size="sm"
                                className="mt-3 w-fit"
                                disabled={busy[c.id]}
                                onClick={() => openAuthorize(c.id, entry?.displayName ?? c.id)}
                              >
                                {busy[c.id] ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                                Re-authorize
                              </Button>
                            </AlertDescription>
                          </Alert>
                        ) : null}

                        {isOAuth && (c.phase === "AuthorizationRequired" || a?.state === "unauthorized") ? (
                          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
                            <span className="flex items-center gap-1.5">
                              <ShieldAlert className="text-destructive size-4" /> Not authorized yet.
                            </span>
                            <Button size="sm" disabled={busy[c.id]} onClick={() => openAuthorize(c.id, entry?.displayName ?? c.id)}>
                              {busy[c.id] ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                              Authorize
                            </Button>
                          </div>
                        ) : null}

                        {isOAuth && a?.state === "authorized" ? (
                          <div className="text-muted-foreground space-y-1 text-sm">
                            <span className="text-foreground flex items-center gap-1.5">
                              <ShieldCheck className="size-4" />
                              Authorized{a.authorizedBy ? ` by ${a.authorizedBy}` : ""}.
                            </span>
                            {a.scope ? <div>Scope: {a.scope}</div> : null}
                            {a.accessTokenExpiresAt ? (
                              <div>Access renews automatically. Current token expires {new Date(a.accessTokenExpiresAt).toLocaleString()}.</div>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                      <CardFooter className="gap-2">
                        {isOAuth && a?.state === "authorized" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy[c.id]}
                            onClick={() => void onRevoke(c.id, entry?.displayName ?? c.id)}
                          >
                            Revoke access
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={busy[c.id]}
                          onClick={() => setDisableTarget(c)}
                        >
                          <Trash2 /> Disable
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      <Dialog open={authTarget !== null} onOpenChange={(open) => !open && setAuthTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authorize {authTarget?.displayName}</DialogTitle>
            <DialogDescription>
              Enter the base URL of your {authTarget?.displayName} instance. We use it to find the
              vendor&apos;s OAuth endpoints, then open a tab where you approve access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="connector-instance-url">Instance URL</Label>
            <Input
              id="connector-instance-url"
              placeholder="https://gitlab.com"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && instanceUrl.trim() && authTarget) {
                  const target = authTarget;
                  const url = instanceUrl.trim();
                  setAuthTarget(null);
                  void onAuthorize(target.id, url);
                }
              }}
            />
            <p className="text-muted-foreground text-sm">
              Use https://gitlab.com for GitLab.com, or your self-hosted instance URL.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuthTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!instanceUrl.trim() || (authTarget ? busy[authTarget.id] : false)}
              onClick={() => {
                if (!authTarget) return;
                const target = authTarget;
                const url = instanceUrl.trim();
                setAuthTarget(null);
                void onAuthorize(target.id, url);
              }}
            >
              {authTarget && busy[authTarget.id] ? <Loader2 className="animate-spin" /> : null}
              Authorize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disableTarget !== null} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable this connector?</DialogTitle>
            <DialogDescription>
              This removes the connector and its tools from your workspace. Any OAuth grant is revoked.
              You can enable it again from the catalog.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disableTarget ? busy[disableTarget.id] : false}
              onClick={() => disableTarget && void onDisable(disableTarget)}
            >
              {disableTarget && busy[disableTarget.id] ? <Loader2 className="animate-spin" /> : null}
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The auth kind of a catalog entry, for deciding whether to poll the grant. */
function catalogAuthKind(catalog: CatalogEntry[], id: string): string {
  return catalog.find((e) => e.id === id)?.auth ?? "none";
}
