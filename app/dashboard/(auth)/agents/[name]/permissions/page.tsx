/**
 * Agent detail Permissions tab — server component.
 *
 * Calls TenantService.ListAgentIdentities to resolve the agent
 * name -> principal_id, then IdentityService.WhoAmI to fetch effective
 * grants. Hands a flat projection to the PermissionsTab client
 * component.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 4.
 */

import { redirect } from 'next/navigation';
import { ConnectError, Code } from '@connectrpc/connect';

import {
  assertAuthorized,
  AuthzDeniedError,
} from '@/src/lib/auth/assert-authorized';
import { userClient } from '@/src/lib/gibson-client';
import { AgentIdentityService, PrincipalKind } from '@/src/gen/gibson/tenant/v1/agent_identity_pb';
import { IdentityService } from '@/src/gen/gibson/identity/v1/identity_pb';
import { GrantsService } from '@/src/gen/gibson/tenant/v1/grants_pb';

import {
  PermissionsTab,
  type ComponentGrantVM,
  type PluginGrantVM,
  type ActiveGrantVM,
  type SourceKind,
} from '@/components/gibson/permissions/PermissionsTab';

// ---------------------------------------------------------------------------
// Source kind mapping (proto enum -> string union)
// ---------------------------------------------------------------------------

function sourceKindString(kind: number): SourceKind {
  // GrantSource_Kind: KIND_UNSPECIFIED=0, KIND_DIRECT=1, KIND_TENANT_MEMBER=2,
  // KIND_TEAM_MEMBER=3, KIND_OWNER=4
  switch (kind) {
    case 1:
      return 'KIND_DIRECT';
    case 2:
      return 'KIND_TENANT_MEMBER';
    case 3:
      return 'KIND_TEAM_MEMBER';
    case 4:
      return 'KIND_OWNER';
    default:
      return 'KIND_DIRECT';
  }
}

// ---------------------------------------------------------------------------
// Server component
// ---------------------------------------------------------------------------

export default async function Page({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;

  try {
    await assertAuthorized('/gibson.identity.v1.IdentityService/WhoAmI');
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect('/dashboard/agents');
    }
    throw err;
  }

  // Step 1: resolve agent name -> principal_id via the existing
  // ListAgentIdentities admin RPC. This is gated on tenant_admin
  // server-side.
  let principalId: string;
  try {
    const tenantClient = userClient(AgentIdentityService);
    const list = await tenantClient.listAgentIdentities({
      pageSize: 200,
      kindFilter: PrincipalKind.AGENT,
    });
    const match = list.identities.find(
      (i) => i.name.toLowerCase() === name.toLowerCase() && !i.revoked,
    );
    if (!match) {
      redirect('/dashboard/agents?missing=' + encodeURIComponent(name));
    }
    principalId = match.principalId;
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.PermissionDenied) {
      redirect('/dashboard/agents');
    }
    throw err;
  }

  // Step 2: WhoAmI for the resolved principal.
  let resp;
  try {
    const idClient = userClient(IdentityService);
    resp = await idClient.whoAmI({ targetPrincipalId: principalId });
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      redirect('/dashboard/agents?missing=' + encodeURIComponent(name));
    }
    throw err;
  }

  // Step 3: also fetch active CG-JWTs filtered to this principal.
  let activeGrants: ActiveGrantVM[] = [];
  try {
    const grantsClient = userClient(GrantsService);
    const ag = await grantsClient.listActiveGrants({});
    activeGrants = ag.grants
      .filter((g) => g.recipientInstallId === principalId)
      .map((g) => ({
        jti: g.jti,
        recipientName: g.recipientName,
        expiresAtUnix: Number(g.expiresAtUnix),
        nearExpiry: g.nearExpiry,
        allowedRpcs: g.allowedRpcs,
      }));
  } catch {
    // Best-effort; the inspector side is read-only and may be an
    // ungated stub in some deployments. Leave activeGrants empty.
    activeGrants = [];
  }

  const componentGrants: ComponentGrantVM[] = resp.componentGrants.map((c) => ({
    componentRef: c.componentRef,
    canRead: c.canRead,
    canConfigure: c.canConfigure,
    canExecute: c.canExecute,
    sources: c.sources.map((s) => ({
      kind: sourceKindString(s.kind),
      sourceObject: s.sourceObject,
    })),
  }));

  const pluginGrants: PluginGrantVM[] = resp.pluginGrants.map((p) => ({
    pluginRef: p.pluginRef,
    sources: p.sources.map((s) => ({
      kind: sourceKindString(s.kind),
      sourceObject: s.sourceObject,
    })),
  }));

  return (
    <div className="container mx-auto py-6 px-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight font-mono text-glow-green">
          {name} — permissions
        </h1>
        <p className="text-sm text-muted-foreground">
          principal_id: <code className="font-mono">{principalId}</code>
        </p>
      </header>
      <PermissionsTab
        principalId={principalId}
        kind="agent"
        componentGrants={componentGrants}
        pluginGrants={pluginGrants}
        activeCapabilityGrants={activeGrants}
      />
    </div>
  );
}

export function generateMetadata({ params }: { params: { name: string } }) {
  return { title: `${params.name} — permissions` };
}
