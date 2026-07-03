'use server';

/**
 * Server actions for the agent / tool detail Permissions tab.
 *
 * Wrap the daemon's GrantsAdminService.WriteAgentGrants and
 * DeleteAgentGrants RPCs so the client component never has to hold a
 * gRPC client. Both actions forward via userClient (which goes through
 * Envoy + ext-authz and bakes a per-RPC assertAuthorized check into the
 * dispatch, dashboard#848 / #902) and revalidate the agent / tool detail
 * page on success. A denial surfaces as AuthzDeniedError from inside the
 * RPC call and is mapped by mapDaemonError (dashboard#904).
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 5.
 */

import 'server-only';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { ConnectError, Code } from '@connectrpc/connect';

import { auth } from '@/auth';
import { userClient } from '@/src/lib/gibson-client';
import {
  GrantsService,
} from '@/src/gen/gibson/tenant/v1/grants_pb';
import { permissionDeniedResult } from '@/src/lib/auth/assert-authorized';
import { logger } from '@/src/lib/logger';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const grantTupleSchema = z.object({
  object: z.string().min(1).max(256),
  relation: z.enum(['can_read', 'can_configure', 'can_execute', 'can_invoke']),
});

const targetSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^(agent_principal|tool_principal|plugin_principal):[A-Za-z0-9_-]+$/,
    'target_principal_id must be agent_principal:<id>, tool_principal:<id>, or plugin_principal:<id>',
  );

const grantsSchema = z.array(grantTupleSchema).min(1).max(64);

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

interface WriteResult {
  written: number;
  alreadyPresent: number;
}
interface DeleteResult {
  deleted: number;
  notPresent: number;
}

// ---------------------------------------------------------------------------
// Common authn / authz / validation
// ---------------------------------------------------------------------------

type FailureResult = { ok: false; error: string; code?: string };

async function preflight(): Promise<FailureResult | null> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Authentication required', code: 'unauthenticated' };
  }
  return null;
}

function mapDaemonError(err: unknown): FailureResult {
  const denied = permissionDeniedResult(err);
  if (denied) return denied;
  if (err instanceof ConnectError) {
    if (err.code === Code.PermissionDenied) {
      return { ok: false, error: 'Permission denied', code: 'permission_denied' };
    }
    if (err.code === Code.NotFound) {
      return { ok: false, error: 'Target principal not found', code: 'not_found' };
    }
    if (err.code === Code.InvalidArgument) {
      return { ok: false, error: err.message, code: 'invalid_argument' };
    }
    if (err.code === Code.Unimplemented) {
      return {
        ok: false,
        error: 'Grant management surface is not enabled on the daemon',
        code: 'unimplemented',
      };
    }
  }
  logger.error(
    { scope: 'agent-permissions', errName: err instanceof Error ? err.name : typeof err },
    'daemon RPC failed',
  );
  return { ok: false, error: 'Daemon error, please try again', code: 'daemon_error' };
}

// ---------------------------------------------------------------------------
// writeAgentGrantsAction
// ---------------------------------------------------------------------------

export async function writeAgentGrantsAction(
  targetPrincipalId: string,
  grantsInput: unknown,
): Promise<ActionResult<WriteResult>> {
  const pre = await preflight();
  if (pre) return pre;

  const targetParsed = targetSchema.safeParse(targetPrincipalId);
  if (!targetParsed.success) {
    return {
      ok: false,
      error: targetParsed.error.issues[0]?.message ?? 'Invalid target_principal_id',
      code: 'invalid_argument',
    };
  }

  const grantsParsed = grantsSchema.safeParse(grantsInput);
  if (!grantsParsed.success) {
    return {
      ok: false,
      error: grantsParsed.error.issues[0]?.message ?? 'Invalid grants',
      code: 'invalid_argument',
    };
  }

  try {
    const client = userClient(GrantsService);
    const resp = await client.writeAgentGrants({
      targetPrincipalId: targetParsed.data,
      grants: grantsParsed.data.map((g) => ({
        object: g.object,
        relation: g.relation,
      })),
    });
    revalidatePath(`/dashboard/agents/${suffixOf(targetParsed.data)}/permissions`);
    revalidatePath(`/dashboard/tools/${suffixOf(targetParsed.data)}/permissions`);
    return {
      ok: true,
      data: { written: resp.written, alreadyPresent: resp.alreadyPresent },
    };
  } catch (err) {
    return mapDaemonError(err);
  }
}

// ---------------------------------------------------------------------------
// deleteAgentGrantsAction
// ---------------------------------------------------------------------------

export async function deleteAgentGrantsAction(
  targetPrincipalId: string,
  grantsInput: unknown,
): Promise<ActionResult<DeleteResult>> {
  const pre = await preflight();
  if (pre) return pre;

  const targetParsed = targetSchema.safeParse(targetPrincipalId);
  if (!targetParsed.success) {
    return {
      ok: false,
      error: targetParsed.error.issues[0]?.message ?? 'Invalid target_principal_id',
      code: 'invalid_argument',
    };
  }

  const grantsParsed = grantsSchema.safeParse(grantsInput);
  if (!grantsParsed.success) {
    return {
      ok: false,
      error: grantsParsed.error.issues[0]?.message ?? 'Invalid grants',
      code: 'invalid_argument',
    };
  }

  try {
    const client = userClient(GrantsService);
    const resp = await client.deleteAgentGrants({
      targetPrincipalId: targetParsed.data,
      grants: grantsParsed.data.map((g) => ({
        object: g.object,
        relation: g.relation,
      })),
    });
    revalidatePath(`/dashboard/agents/${suffixOf(targetParsed.data)}/permissions`);
    revalidatePath(`/dashboard/tools/${suffixOf(targetParsed.data)}/permissions`);
    return {
      ok: true,
      data: { deleted: resp.deleted, notPresent: resp.notPresent },
    };
  } catch (err) {
    return mapDaemonError(err);
  }
}

// suffixOf strips the prefix from a principal_id ("agent_principal:abc" -> "abc")
// so the revalidated path matches what the agent / tool detail page uses.
// The actual page resolves principal_id by name in the other direction; this
// is a best-effort revalidation hint.
function suffixOf(principalId: string): string {
  const idx = principalId.indexOf(':');
  return idx === -1 ? principalId : principalId.slice(idx + 1);
}
