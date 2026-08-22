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

export function ConnectorsContent() {
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);
  const [enabled, setEnabled] = React.useState<Connector[]>([]);
  const [auth, setAuth] = React.useState<Record<string, ConnectorAuth>>({});
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [disableTarget, setDisableTarget] = React.useState<Connector | null>(null);

  const setConnectorBusy = React.useCallback((id: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [id]: value }));
  }, []);

  const loadAuth = React.useCallback(async (connectorId: string) => {
    try {
      const res = await fetch(`/api/settings/connectors/${encodeURIComponent(connectorId)}`);
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
      const res = await fetch("/api/settings/connectors");
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

  async function onEnable(entry: CatalogEntry) {
    setConnectorBusy(entry.id, true);
    try {
      const res = await fetch("/api/settings/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalogId: entry.id }),
      });
      if (!res.ok) {
        toast.error(await readError(res, `Could not enable ${entry.displayName}.`));
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

  async function onAuthorize(connectorId: string) {
    setConnectorBusy(connectorId, true);
    try {
      const res = await fetch(`/api/settings/connectors/${encodeURIComponent(connectorId)}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        toast.error(await readError(res, "Could not start authorization."));
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
      const res = await fetch(`/api/settings/connectors/${encodeURIComponent(connectorId)}/revoke`, {
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
      const res = await fetch(`/api/settings/connectors/${encodeURIComponent(connector.id)}`, {
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
          Give your agents tools from the services you already use. Enable a connector, approve access
          once, and its tools become callable in missions, attributed to the agent and to you.
        </p>
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
                                onClick={() => void onAuthorize(c.id)}
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
                            <Button size="sm" disabled={busy[c.id]} onClick={() => void onAuthorize(c.id)}>
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
