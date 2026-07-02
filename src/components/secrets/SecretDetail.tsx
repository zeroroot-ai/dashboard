"use client";

/**
 * SecretDetail, client component that renders secret metadata and action buttons.
 *
 * Receives the pre-fetched SecretMetadata from the server component page.
 *
 * SECURITY: NO value affordance. NO "Show value" button. No value is ever
 * fetched, stored, or rendered on this component or its children.
 *
 * Actions:
 *   - Rotate: opens RotateModal
 *   - Delete: opens DeleteModal
 *   - Audit log link: subnav to /secrets/[id]/audit
 *
 * Spec: secrets-tenant-lifecycle Task 12, Requirement 1.1.
 */

import * as React from "react";
import Link from "next/link";
import { ClipboardListIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { SecretMetadata } from "@/src/gen/gibson/tenant/v1/secrets_pb";
import { SecretCategory } from "@/src/gen/gibson/tenant/v1/secrets_pb";
import { RotateModal } from "./RotateModal";
import { DeleteModal } from "./DeleteModal";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUnixTs(unixSeconds: bigint): string {
  if (!unixSeconds || unixSeconds === BigInt(0)) return "-";
  const d = new Date(Number(unixSeconds) * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryLabel(cat: SecretCategory): string {
  switch (cat) {
    case SecretCategory.CRED:
      return "Credential";
    case SecretCategory.PROVIDER_CONFIG:
      return "Provider config";
    default:
      return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Metadata row
// ---------------------------------------------------------------------------

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-4">
      <dt className="text-muted-foreground w-36 shrink-0 text-sm font-medium">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SecretDetailProps {
  metadata: SecretMetadata;
}

export function SecretDetail({ metadata }: SecretDetailProps) {
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  // Gate action buttons on their respective admin RPCs.
  // Hide on loading=true (no FOUC). Spec: dashboard-authz-ui-gating Task 14.
  const { allowed: canRotate, loading: rotateLoading } = useAuthorize(
    "/gibson.tenant.v1.SecretsService/RotateSecret",
  );
  const { allowed: canDelete, loading: deleteLoading } = useAuthorize(
    "/gibson.tenant.v1.SecretsService/DeleteSecret",
  );

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h3 className="text-lg font-semibold font-mono break-all">{metadata.name}</h3>
          <Badge>
            {categoryLabel(metadata.category)}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!rotateLoading && canRotate && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRotateOpen(true)}
            >
              <RotateCcwIcon className="mr-2 h-4 w-4" aria-hidden="true" />
              Rotate
            </Button>
          )}
          {!deleteLoading && canDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon className="mr-2 h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* Metadata fields */}
      <dl className="space-y-3">
        <MetaRow label="Version">
          <span className="font-mono">v{String(metadata.version)}</span>
        </MetaRow>
        <MetaRow label="Created">
          {formatUnixTs(metadata.createdAtUnix)}
          {metadata.createdBy && (
            <span className="text-muted-foreground ml-2 text-xs">by {metadata.createdBy}</span>
          )}
        </MetaRow>
        <MetaRow label="Last rotated">
          {formatUnixTs(metadata.updatedAtUnix)}
          {metadata.updatedBy && metadata.updatedBy !== metadata.createdBy && (
            <span className="text-muted-foreground ml-2 text-xs">by {metadata.updatedBy}</span>
          )}
        </MetaRow>
        <MetaRow label="Last accessed">
          {formatUnixTs(metadata.lastAccessedAtUnix)}
        </MetaRow>
      </dl>

      <Separator />

      {/* Plugin associations */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Plugin associations</h4>
        {metadata.pluginAssociations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No plugins are currently bound to this secret.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Plugins with access to this secret">
            {metadata.pluginAssociations.map((pluginId) => (
              <li key={pluginId}>
                <Badge variant="outline" className="font-mono text-xs">
                  {pluginId}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      {/* Audit subnav */}
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href={`/dashboard/pages/settings/audit?secret_id=${encodeURIComponent(metadata.name)}`}
            className="flex items-center gap-2"
          >
            <ClipboardListIcon className="h-4 w-4" aria-hidden="true" />
            View audit log for this secret
          </Link>
        </Button>
      </div>

      {/* Modals */}
      <RotateModal
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        secretName={metadata.name}
      />
      <DeleteModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        secretName={metadata.name}
        affectedPlugins={metadata.pluginAssociations}
      />
    </div>
  );
}
