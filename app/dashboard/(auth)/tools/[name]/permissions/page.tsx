/**
 * Tool detail Permissions tab, server component.
 *
 * Mirror of the agent permissions page (kind=TOOL). See the agent
 * page docstring for the resolution + WhoAmI flow.
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
import { AgentIdentityService, PrincipalKind } from '@/src/gen/gibson/agentidentity/v1/agent_identity_pb';
import { IdentityService } from '@/src/gen/gibson/identity/v1/identity_pb';
import { GrantsService } from '@/src/gen/gibson/tenant/v1/grants_pb';

import {
  PermissionsTab,
  type ComponentGrantVM,
  type PluginGrantVM,
  type ActiveGrantVM,
  type SourceKind,
} from '@/components/gibson/permissions/PermissionsTab';

function sourceKindString(kind: number): SourceKind {
  switch (kind) {
    case 1: return 'KIND_DIRECT';
    case 2: return 'KIND_TENANT_MEMBER';
    case 3: return 'KIND_TEAM_MEMBER';
    case 4: return 'KIND_OWNER';
    default: return 'KIND_DIRECT';
  }
}

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
      redirect('/dashboard/tools');
    }
    throw err;
  }

  let principalId: string;
  try {
    const tenantClient = userClient(AgentIdentityService);
    const list = await tenantClient.listAgentIdentities({
      pageSize: 200,
      kindFilter: PrincipalKind.TOOL,
    });
    const match = list.identities.find(
      (i) => i.name.toLowerCase() === name.toLowerCase() && !i.revoked,
    );
    if (!match) {
      redirect('/dashboard/tools?missing=' + encodeURIComponent(name));
    }
    principalId = match.principalId;
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.PermissionDenied) {
      redirect('/dashboard/tools');
    }
    throw err;
  }

  let resp;
  try {
    const idClient = userClient(IdentityService);
    resp = await idClient.whoAmI({ targetPrincipalId: principalId });
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      redirect('/dashboard/tools?missing=' + encodeURIComponent(name));
    }
    throw err;
  }

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
          {name} permissions
        </h1>
        <p className="text-sm text-muted-foreground">
          principal_id: <code className="font-mono">{principalId}</code>
        </p>
      </header>
      <PermissionsTab
        principalId={principalId}
        kind="tool"
        componentGrants={componentGrants}
        pluginGrants={pluginGrants}
        activeCapabilityGrants={activeGrants}
      />
    </div>
  );
}

export function generateMetadata({ params }: { params: { name: string } }) {
  return { title: `${params.name} permissions` };
}
