// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * POST /api/agents/register, provision a new agent identity via the daemon.
 *
 * Spec: agent-service-credentials (Task 16).
 *
 * Flow:
 *   1. Authenticate the caller via Auth.js (`auth()`).
 *   2. Resolve the caller's active tenant and verify the caller holds at
 *      least the `admin` role on that tenant.
 *   3. Validate the request body (`name` required, `description` optional).
 *   4. Call `AgentIdentityService.CreateAgentIdentity` over gRPC via the
 *      Envoy edge (dashboard → Envoy → daemon). The daemon handles all
 *      IdP provisioning and FGA tuple writes internally.
 *   5. Return the daemon's `bootstrapToken` and `gibsonUrl` to the browser
 *      unchanged.
 *
 * Under the unified-identity model (ADR-0045, gibson#670) the daemon no
 * longer mints an OAuth2 `client_id`/`client_secret` pair for a
 * component. The sole credential is a one-time, daemon-signed
 * Capability-Grant `bootstrap_token` that the component presents to the
 * CG register endpoint on its first start. There is no CLI enrollment
 * step: the component reads `GIBSON_URL` and `GIBSON_BOOTSTRAP_TOKEN` and
 * enrolls itself.
 *
 * SECURITY:
 *   - No IdP-vendor credentials are held in this file. The daemon owns
 *     the IdP admin surface; the dashboard is a thin proxy.
 *   - The `bootstrapToken` is forwarded directly from the daemon response
 *     and is never logged here. Every error path is sanitized.
 *   - Logger calls in this file deliberately do NOT reference
 *     `bootstrapToken`, the build guard
 *     `scripts/check-no-secret-in-logs.mjs` verifies this.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ConnectError, Code } from '@connectrpc/connect';

import { auth } from '@/auth';
import { getServerSession } from '@/src/lib/auth';
import { hasRoleAtLeast } from '@/src/lib/auth/roles';
import { requireActiveTenant } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import {
  AgentIdentityService,
  PrincipalKind,
} from '@/src/gen/gibson/agentidentity/v1/agent_identity_pb';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { GrantsService } from '@/src/gen/gibson/tenant/v1/grants_pb';

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * Agent display-name pattern. Tight enough that the resulting service-account
 * name is always valid (no whitespace, no path separators, no shell
 * metacharacters).
 */
const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Per-action FGA grants the wizard's Permissions step emits.
 * Spec: component-bootstrap-e2e Requirement 8.
 */
const ComponentGrantSchema = z.object({
  componentRef: z.string().min(1).max(256),
  relation: z.enum(['can_read', 'can_configure', 'can_execute', 'can_invoke']),
});

const RegisterAgentSchema = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .max(63, 'name must be 63 characters or fewer')
    .regex(
      AGENT_NAME_PATTERN,
      'name must be lowercase letters, digits, and hyphens (max 63 chars)',
    ),
  description: z.string().max(256).optional(),
  /**
   * Component kind. Defaults to AGENT for backward compatibility with
   * the original /api/agents/register caller (RegisterAgentForm).
   * Spec: component-bootstrap-e2e Requirement 5.
   */
  kind: z.enum(['agent', 'tool', 'plugin']).optional().default('agent'),
  /**
   * Optional per-action FGA grants applied at creation time. Each
   * entry is forwarded to AgentIdentityService.CreateAgentIdentity as
   * a ComponentGrant{component_ref, relation}. The daemon validates
   * the relation/kind compatibility (only TOOL targets may receive
   * can_invoke).
   * Spec: component-bootstrap-e2e Requirement 8.
   */
  componentGrants: z.array(ComponentGrantSchema).max(64).optional().default([]),
  /**
   * Names of tenant secrets the component may resolve (ADR-0097,
   * dashboard#174). A tenant admin assigns secret access here; the
   * component never declares it (gibson#554). Only a plugin can resolve a
   * secret, so the list is refused for an agent or a tool. An empty list is
   * valid: the component then resolves nothing.
   */
  secretGrants: z.array(z.string().min(1).max(1024)).max(64).optional().default([]),
}).refine((b) => b.kind === 'plugin' || b.secretGrants.length === 0, {
  message: 'only a plugin can be granted secret access; an agent or a tool reaches a secret through a plugin',
  path: ['secretGrants'],
});

export type RegisterAgentRequestBody = z.infer<typeof RegisterAgentSchema>;

export interface RegisterAgentResponseBody {
  /**
   * One-time, daemon-signed Capability-Grant bootstrap token, emitted
   * exactly once; cannot be retrieved again. The dashboard surfaces it
   * to the registering admin in the one-time credential panel. The
   * component presents it to the CG register endpoint to complete its
   * first host registration (ADR-0045).
   */
  bootstrapToken: string;
  /** Public Envoy URL the agent should dial. */
  gibsonUrl: string;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // CSRF, src/lib/auth/csrf.ts: the session cookie is sameSite=lax, so a
  // mutating handler must check the double-submit token itself.
  try {
    await requireCsrf(request);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  // Step 1, authenticate. Uses the raw auth() helper (no FGA enrichment)
  // for the cheap unauth fast-path; the enriched session below is only
  // touched after we know we have a session.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  // Step 2, resolve active tenant + verify admin role.
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    console.warn('[agents/register] no usable active tenant:', (err as Error).name);
    return NextResponse.json(
      {
        error: {
          code: 'NO_ACTIVE_TENANT',
          message: 'Select a tenant before registering an agent',
        },
      },
      { status: 412 },
    );
  }

  // Re-fetch the enriched session purely for rolesByTenant, memoized via
  // React cache() inside getServerSession.
  const enriched = await getServerSession();
  if (!enriched) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Session expired' } },
      { status: 401 },
    );
  }
  if (!hasRoleAtLeast(enriched, tenantId, 'admin')) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Only tenant admins or owners may register agents',
        },
      },
      { status: 403 },
    );
  }

  // Step 3, validate body.
  let parsedBody: RegisterAgentRequestBody;
  try {
    const json = await request.json();
    const result = RegisterAgentSchema.safeParse(json);
    if (!result.success) {
      const first = result.error.issues[0];
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: first?.message ?? 'Invalid request body',
          },
        },
        { status: 400 },
      );
    }
    parsedBody = result.data;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON in request body',
        },
      },
      { status: 400 },
    );
  }

  // Step 4, call AgentIdentityService.CreateAgentIdentity via gRPC.
  // The daemon handles IdP provisioning, FGA tuple writes, and audit.
  // bootstrapToken is present in the daemon response and forwarded to
  // the browser exactly once; it is never stored or logged here.
  let daemonResp: {
    bootstrapToken: string;
    gibsonUrl: string;
  };
  let principalId: string;
  try {
    const client = userClient(AgentIdentityService);
    const resp = await client.createAgentIdentity({
      name: parsedBody.name,
      kind: principalKindFromString(parsedBody.kind),
      description: parsedBody.description ?? '',
      componentGrants: parsedBody.componentGrants.map((g) => ({
        componentRef: g.componentRef,
        relation: g.relation,
      })),
      idempotencyKey: randomUUID(),
    });
    daemonResp = {
      bootstrapToken: resp.bootstrapToken,
      gibsonUrl: resp.gibsonUrl,
    };
    principalId = resp.principalId;
  } catch (err) {
    return daemonErrorResponse(err);
  }

  // Step 4b, write the secret grants BEFORE the bootstrap token leaves the
  // server. The component cannot start without the token, so it never
  // starts before its access exists. When the grant fails the token is not
  // returned, and the new identity holds no secret access (fail closed).
  if (parsedBody.secretGrants.length > 0) {
    try {
      await userClient(GrantsService).writeSecretGrants({
        targetPrincipalId: principalId,
        secretNames: parsedBody.secretGrants,
      });
    } catch (err) {
      return secretGrantErrorResponse(err);
    }
  }

  // Step 5, return credentials to the browser.
  // Defense-in-depth: forbid any cache layer from ever storing the payload.
  const body: RegisterAgentResponseBody = daemonResp;
  return NextResponse.json(body, {
    status: 201,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

/**
 * principalKindFromString maps the wizard's lowercase kind discriminator
 * to the AgentIdentityService PrincipalKind enum.
 *
 * Spec: component-bootstrap-e2e Requirement 5.
 */
function principalKindFromString(kind: 'agent' | 'tool' | 'plugin'): PrincipalKind {
  switch (kind) {
    case 'agent':
      return PrincipalKind.AGENT;
    case 'tool':
      return PrincipalKind.TOOL;
    case 'plugin':
      return PrincipalKind.PLUGIN;
  }
}

/**
 * The answer when the secret grant of a new component fails. The identity
 * exists but holds no secret access, and its token is not returned. A
 * secret the tenant does not own is a 400 that names the cause.
 */
function secretGrantErrorResponse(err: unknown): NextResponse {
  const code = err instanceof ConnectError ? err.code : undefined;
  console.error('[agents/register] secret grant failed:', code ?? (err as Error)?.name);
  if (code === Code.NotFound || code === Code.InvalidArgument) {
    return NextResponse.json(
      {
        error: {
          code: 'SECRET_GRANT_REFUSED',
          message: 'A selected secret is not a secret of this workspace. Nothing was granted.',
        },
      },
      { status: 400 },
    );
  }
  if (code === Code.PermissionDenied) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Permission denied' } },
      { status: 403 },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: 'SECRET_GRANT_FAILED',
        message: 'The secret access could not be written. The component was not handed a credential.',
      },
    },
    { status: 502 },
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Convert a daemon gRPC failure into a sanitized HTTP response. ConnectError
 * codes are mapped to HTTP status codes; the message is deliberately vague
 * toward the client to avoid leaking internal topology.
 */
function daemonErrorResponse(err: unknown): NextResponse {
  if (err instanceof ConnectError) {
    console.error('[agents/register] daemon RPC failed:', err.code, err.message);
    if (err.code === Code.AlreadyExists) {
      return NextResponse.json(
        {
          error: {
            code: 'AGENT_EXISTS',
            message: 'An agent with that name already exists',
          },
        },
        { status: 409 },
      );
    }
    if (err.code === Code.PermissionDenied) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Permission denied',
          },
        },
        { status: 403 },
      );
    }
    if (err.code === Code.Unavailable) {
      return NextResponse.json(
        {
          error: {
            code: 'DAEMON_UNAVAILABLE',
            message: 'Identity provisioning service is temporarily unavailable',
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: 'DAEMON_ERROR',
          message: 'Failed to register agent, please try again',
        },
      },
      { status: 502 },
    );
  }
  console.error('[agents/register] unexpected failure:', (err as Error)?.name ?? typeof err);
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to register agent',
      },
    },
    { status: 500 },
  );
}
