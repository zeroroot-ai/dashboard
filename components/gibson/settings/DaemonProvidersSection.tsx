"use client";

/**
 * DaemonProvidersSection
 *
 * Informational panel showing the full set of LLM provider types the Gibson
 * daemon reports it can construct, sourced from the GetSupportedProviders
 * admin RPC. This is the dynamic counterpart to the hard-coded dashboard
 * provider table — every provider returned here can in principle be
 * configured via `gibson.yaml`, and a future revision of this page will
 * move the form itself to consume this descriptor directly.
 *
 * For now this panel is read-only: it lets operators verify the daemon's
 * BYOK surface matches what the dashboard form exposes and flags the gap
 * when new provider types land in the daemon before the form catches up.
 */

import * as React from "react";
import { AlertCircle, CloudCog, Link2, Loader2, Server } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useSupportedProviders } from "@/src/hooks/useSupportedProviders";
import type { SupportedProviderDescriptor } from "@/src/lib/gibson-client";

export function DaemonProvidersSection() {
  const { data, isLoading, isError, error } = useSupportedProviders();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <CloudCog className="size-4" />
          Daemon-supported providers
          {!isLoading && data && (
            <Badge variant="secondary" className="ml-2 font-mono text-xs">
              {data.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Read-only view of every provider type Gibson can construct, sourced from the
          daemon&apos;s <code className="font-mono">GetSupportedProviders</code> RPC. Use
          this to verify the BYOK surface — unconfigured types can be added via{" "}
          <code className="font-mono">gibson.yaml</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              {error?.message ?? "Failed to load supported providers from daemon."}
            </AlertDescription>
          </Alert>
        )}

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!isLoading && data && data.length === 0 && (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              Daemon reported zero supported providers. This is unexpected — check daemon logs.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && data && data.length > 0 && (
          <ul className="divide-border divide-y">
            {data.map((descriptor) => (
              <DaemonProviderRow key={descriptor.type} descriptor={descriptor} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DaemonProviderRow({ descriptor }: { descriptor: SupportedProviderDescriptor }) {
  const requiredFields = descriptor.credentials.filter((f) => f.required);
  const modelCount = descriptor.defaultModels.length;

  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{descriptor.displayName}</span>
          <code className="text-muted-foreground font-mono text-xs">{descriptor.type}</code>
          {descriptor.selfHosted && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Server className="size-3" />
              self-hosted
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>
            {requiredFields.length === 0
              ? "no required credentials"
              : `${requiredFields.length} required field${requiredFields.length === 1 ? "" : "s"}`}
          </span>
          {modelCount > 0 && (
            <span>
              {modelCount} default model{modelCount === 1 ? "" : "s"}
            </span>
          )}
          {requiredFields.length > 0 && (
            <span className="font-mono">
              {requiredFields.map((f) => f.key).join(", ")}
            </span>
          )}
        </div>
      </div>
      {descriptor.docsUrl && (
        <a
          href={descriptor.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          aria-label={`Open upstream docs for ${descriptor.displayName}`}
        >
          <Link2 className="size-3" />
          docs
        </a>
      )}
    </li>
  );
}

// Loader used by consumers who want to gate the whole section on data readiness.
export function DaemonProvidersSectionLoader() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" />
          Loading daemon providers...
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
