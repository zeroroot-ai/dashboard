/**
 * VersionBanner — non-blocking notice when the dashboard's
 * vendored mission-authoring bundle version differs from the
 * daemon's reported SDK version. Hidden when versions match or
 * when no daemon version is supplied.
 *
 * The bundle version comes from src/data/mission-authoring-version.json
 * (written by scripts/vendor-mission-authoring-bundle.mjs at build
 * time). The daemon version is sourced by the caller from a
 * server-action probe and passed in as a prop.
 *
 * Spec: mission-dashboard-rewrite Requirement 4 AC 4.
 */

"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

import bundleVersion from "@/src/data/mission-authoring-version.json";

interface VersionBannerProps {
  /**
   * Daemon-reported SDK version. When undefined, the banner
   * stays hidden (the dashboard hasn't successfully probed the
   * daemon yet — we don't want a pre-probe flash of warning).
   */
  daemonVersion?: string;
}

interface BundleVersionMeta {
  version: string;
  vendoredAt: string;
}

export function VersionBanner({ daemonVersion }: VersionBannerProps) {
  const meta = bundleVersion as BundleVersionMeta;

  if (!daemonVersion) return null;
  if (meta.version === daemonVersion) return null;

  // Bundle versions like "sibling-checkout" or "tarball-override"
  // are dev-mode signals — flag them differently than a true
  // production version drift.
  const isDevBundle = !meta.version.startsWith("v");

  return (
    <Alert
      variant="default"
      className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/20"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Mission schema version mismatch</AlertTitle>
      <AlertDescription className="text-sm">
        Dashboard bundle:{" "}
        <code className="font-mono text-xs">{meta.version}</code>
        {isDevBundle ? " (development)" : null} &middot; daemon SDK:{" "}
        <code className="font-mono text-xs">{daemonVersion}</code>.
        Authoring still works, but the daemon may reject or ignore
        fields the dashboard accepts. Refresh the dashboard or pull
        a matching bundle to align.
      </AlertDescription>
    </Alert>
  );
}

/**
 * useBundleVersion — convenience hook returning the vendored
 * bundle's version string. Useful for surfacing the version in
 * settings / about pages.
 */
export function useBundleVersion(): string {
  return (bundleVersion as BundleVersionMeta).version;
}
