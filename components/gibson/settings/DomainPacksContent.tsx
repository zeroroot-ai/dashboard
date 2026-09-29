// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";
/**
 * DomainPacksContent
 *
 * The Domain Pack catalog panel (ADR-0033, gibson#383). A Domain Pack is
 * curated, versioned structure, taxonomy labels, ontology extensions and
 * technique-to-CEL-predicate bindings that a settlement can reason about
 * once enabled. A tenant admin browses the curated catalog and enables or
 * disables a pack with one toggle; the daemon folds the corresponding
 * DomainPackEnabled/DomainPackDisabled event into that tenant's live World
 * only (ADR-0033: "per-tenant, not per-install").
 *
 * Enable and Disable are tenant-admin RPCs (ADR-0067, mirroring
 * ConnectorService), so the toggle gates on useAuthorize with the
 * hide-on-loading pattern: a member sees the catalog and its enabled state,
 * read-only, never the toggle. The server actions enforce the same registry
 * entry via the transport's baked-in assertAuthorized, so hiding is
 * cosmetic, not the security boundary.
 *
 * Fails loud: a daemon-unavailable response surfaces as a distinct error
 * banner with a Retry action, never a silently empty catalog.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BoxIcon, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  listDomainPacksAction,
  enableDomainPackAction,
  disableDomainPackAction,
} from "@/app/actions/domain-packs";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
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
import { Switch } from "@/components/ui/switch";
import type {
  DomainPackCatalogEntryDTO as DomainPackCatalogEntry,
  DomainPackViewDTO as DomainPackView,
} from "@/src/lib/gibson-client/domain-pack-types";

// Tenant-admin lifecycle RPCs. Members must not see the toggle, so it gates
// through useAuthorize.
const DOMAIN_PACK_ENABLE_RPC = "/gibson.tenant.v1.DomainPackService/EnableDomainPack";
const DOMAIN_PACK_DISABLE_RPC = "/gibson.tenant.v1.DomainPackService/DisableDomainPack";

/**
 * An action result with `code === "unauthenticated"` means the session
 * expired (either the dashboard session is gone, or the daemon returned a
 * gRPC Unauthenticated that serverActionError classified).
 */
function isSessionExpired(code?: string): boolean {
  return code === "unauthenticated";
}

export function DomainPacksContent({ docsHref }: { docsHref: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = React.useState<DomainPackCatalogEntry[]>([]);
  const [enabled, setEnabled] = React.useState<DomainPackView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});

  // Admin-only lifecycle control, hide-on-loading (no FOUC).
  const { allowed: canEnable, loading: enableAuthLoading } = useAuthorize(DOMAIN_PACK_ENABLE_RPC);
  const { allowed: canDisable, loading: disableAuthLoading } = useAuthorize(DOMAIN_PACK_DISABLE_RPC);
  const showToggle = !enableAuthLoading && !disableAuthLoading && canEnable && canDisable;

  const setPackBusy = React.useCallback((name: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [name]: value }));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listDomainPacksAction();
      if (!res.ok) {
        setLoadError(res.error || "The Domain Pack service is unavailable.");
        return;
      }
      setCatalog(res.data.catalog);
      setEnabled(res.data.enabled);
    } catch {
      setLoadError("The Domain Pack service could not be reached.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const enabledByName = React.useMemo(
    () => new Map(enabled.map((p) => [p.name, p])),
    [enabled],
  );

  const notifySessionExpired = React.useCallback(() => {
    toast.error("Your session expired", {
      description: "Sign in again to continue.",
      action: { label: "Sign in", onClick: () => router.push("/login") },
    });
  }, [router]);

  async function onToggle(entry: DomainPackCatalogEntry, next: boolean) {
    setPackBusy(entry.name, true);
    try {
      const res = next
        ? await enableDomainPackAction(entry.name)
        : await disableDomainPackAction(entry.name);
      if (!res.ok) {
        if (isSessionExpired(res.code)) {
          notifySessionExpired();
        } else {
          toast.error(
            res.error || `Could not ${next ? "enable" : "disable"} ${entry.name}.`,
          );
        }
        return;
      }
      toast.success(`${entry.name} ${next ? "enabled" : "disabled"}.`);
      await load();
    } catch {
      toast.error(
        `Could not reach the service to ${next ? "enable" : "disable"} ${entry.name}.`,
      );
    } finally {
      setPackBusy(entry.name, false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Domain Packs</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A Domain Pack is a curated set of taxonomy labels and settlement predicates for
          one domain. Enable a pack to make its bindings live for your agents; disable it
          to remove them. Changes apply to this workspace only.
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
          How Domain Packs work
        </a>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The Domain Pack service is unavailable</AlertTitle>
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
          <Loader2 className="animate-spin" /> Loading Domain Packs...
        </div>
      ) : null}

      {!loading && !loadError ? (
        catalog.length === 0 ? (
          <Card className="border-border/60 bg-card/40 border-dashed">
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No Domain Packs are in the catalog yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {catalog.map((entry) => {
              const view = enabledByName.get(entry.name);
              const isEnabled = view !== undefined;
              return (
                <Card key={entry.name} className="border-border/60 bg-card/60 flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base capitalize">
                        <BoxIcon className="size-4" /> {entry.name}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          v{isEnabled ? view.version : entry.version}
                        </Badge>
                        {entry.entitlement ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {entry.entitlement}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Free
                          </Badge>
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      {entry.techniques.length > 0
                        ? `Binds ${entry.techniques.length} technique${entry.techniques.length === 1 ? "" : "s"}: ${entry.techniques.join(", ")}`
                        : "No technique bindings yet."}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {isEnabled ? "Enabled for this workspace" : "Not enabled"}
                    </span>
                    {showToggle ? (
                      <div className="flex items-center gap-2">
                        {busy[entry.name] ? <Loader2 className="size-4 animate-spin" /> : null}
                        <Switch
                          checked={isEnabled}
                          disabled={busy[entry.name]}
                          onCheckedChange={(next) => void onToggle(entry, next)}
                          aria-label={`${isEnabled ? "Disable" : "Enable"} ${entry.name}`}
                        />
                      </div>
                    ) : (
                      <Badge variant={isEnabled ? "success" : "outline"} className="text-[10px]">
                        {isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
