/**
 * POST /api/agents/register — provision a new agent identity in Zitadel.
 *
 * Spec: unified-identity-and-authorization Phase 4 (R1.4, R9.7, R9.8).
 *
 * Flow:
 *   1. Authenticate the caller via Auth.js (`auth()`).
 *   2. Resolve the caller's active tenant (server-side cookie + FGA
 *      memberships) and verify the caller holds at least the `admin` role
 *      on that tenant — only tenant admins/owners may mint agent
 *      identities.
 *   3. Validate the request body (`name` required, `description` optional).
 *   4. Call the Zitadel admin API (via `getSignupZitadelAdminClient()` —
 *      reused for org-bot PAT) to:
 *        a) create a machine user named `agent-${tenant}-${name}`,
 *        b) mint a single `client_secret` (returned exactly once),
 *        c) add the machine user as a member of the tenant's project so
 *           the issued JWT carries the `agent` role claim.
 *   5. Return `{ clientId, clientSecret, gibsonUrl, enrollCommand }` to
 *      the browser. The `clientSecret` field is the ONLY place the secret
 *      ever appears outside Zitadel; it is never logged here.
 *
 * SECURITY:
 *   - The route is server-only (Next.js route handler) — Zitadel admin
 *     credentials never reach the browser.
 *   - The `client_secret` is included only in the success response body.
 *     Every error path is sanitized; we never echo the secret in logs,
 *     errors, or trace events.
 *   - Logger calls in this file deliberately do NOT reference
 *     `client_secret` — the build guard
 *     `scripts/check-no-secret-in-logs.mjs` verifies this.
 */

import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { getServerSession } from '@/src/lib/auth';
import { hasRoleAtLeast } from '@/src/lib/auth/roles';
import { getActiveTenant } from '@/src/lib/auth/active-tenant';
import { getSignupZitadelAdminClient } from '@/src/lib/zitadel/admin-client-factory';
import { ZitadelApiError } from '@/src/lib/zitadel/errors';

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * Agent display-name pattern. Tight enough that the resulting Zitadel
 * machine-user `userName` (`agent-${tenant}-${name}`) is always a valid
 * Zitadel login name (no whitespace, no path separators, no shell
 * metacharacters that would mangle the pre-filled `gibson-cli` command).
 */
const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

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
});

export type RegisterAgentRequestBody = z.infer<typeof RegisterAgentSchema>;

export interface RegisterAgentResponseBody {
  /** OAuth2 client_id for the agent's Zitadel service account. */
  clientId: string;
  /**
   * OAuth2 client_secret — emitted exactly once; cannot be retrieved
   * again. The dashboard surfaces it to the registering admin in the
   * one-time credential panel.
   */
  clientSecret: string;
  /** Public Envoy URL the agent should dial. */
  gibsonUrl: string;
  /**
   * Pre-filled `gibson-cli agent enroll …` invocation. Convenience for
   * the admin to copy-paste onto the agent host.
   */
  enrollCommand: string;
}

// ---------------------------------------------------------------------------
// Env resolution
// ---------------------------------------------------------------------------

/**
 * Public Envoy URL used by external (customer-network) agents. Defaults
 * to the Kind dev URL so the route is exercisable in a local cluster
 * without extra env wiring.
 */
function envoyPublicUrl(): string {
  return process.env.ENVOY_PUBLIC_URL ?? 'https://api.zero-day.local:30443';
}

/**
 * Zitadel project ID the agent should be granted membership on. The same
 * project also gates Envoy's `jwt_authn` audience — without this
 * membership the issued JWT's `urn:zitadel:iam:org:project:roles` claim
 * is empty and ext-authz rejects the agent's calls.
 *
 * TODO(unified-identity-and-authorization 4.5): once Phase 7
 * (tenant-operator) lands, the per-tenant project ID will be on the
 * Tenant CRD rather than a single global env. Until then the dashboard
 * uses the platform-wide `gibson-platform` project (matching the
 * service-token scope in `auth/service-token.ts`).
 */
function agentProjectId(): string {
  return process.env.ZITADEL_AGENT_PROJECT_ID ?? 'gibson-platform';
}

/** Project role granted to every newly-registered agent. */
const AGENT_PROJECT_ROLE = 'agent';

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1 — authenticate. Uses the raw auth() helper (no FGA enrichment)
  // for the cheap unauth fast-path; the enriched session below is only
  // touched after we know we have a session.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  // Step 2 — resolve active tenant + verify admin role.
  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch (err) {
    // Either no active-tenant cookie or the cookie's tenant is no longer
    // in the user's memberships. Both surface to the caller as 412
    // Precondition Failed — the UI redirects to /select-tenant. We log
    // the *kind* of failure but never the user identity to avoid
    // cluttering ops dashboards with PII.
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

  // Re-fetch the enriched session purely for rolesByTenant — this is
  // memoized via React cache() inside getServerSession so the cost is
  // one daemon round-trip per request, shared with any Server Component
  // higher up the tree.
  const enriched = await getServerSession();
  if (!enriched) {
    // The session evaporated between auth() and getServerSession() —
    // surface as 401 rather than crashing.
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

  // Step 3 — validate body.
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

  // Step 4 — Zitadel calls.
  //
  // The signup-bot PAT is reused here. It already holds
  // IAM_USER_MANAGER, which permits both POST /users/machine and
  // PUT /users/{id}/secret in the IAM org. For tenant-scoped orgs the
  // per-tenant org ID will be wired through the Tenant CRD — see the
  // TODO on agentProjectId() above.
  const username = `agent-${tenantId}-${parsedBody.name}`;
  let zitadelClient: ReturnType<typeof getSignupZitadelAdminClient>;
  try {
    zitadelClient = getSignupZitadelAdminClient();
  } catch (err) {
    console.error('[agents/register] zitadel admin client unavailable:', (err as Error).message);
    return NextResponse.json(
      {
        error: {
          code: 'ZITADEL_UNAVAILABLE',
          message: 'Identity provider is not configured',
        },
      },
      { status: 502 },
    );
  }

  let machineUserId: string;
  try {
    const created = await zitadelClient.createMachineUser({
      username,
      name: parsedBody.name,
      description: parsedBody.description,
    });
    machineUserId = created.userId;
  } catch (err) {
    return zitadelErrorResponse('createMachineUser', err);
  }

  // The machine secret object is bound to a tightly-scoped variable and
  // returned to the browser without being passed through any logger.
  let secret: { clientId: string; clientSecret: string };
  try {
    const minted = await zitadelClient.addMachineSecret(machineUserId);
    // Hold both halves in a typed local — the field name `clientSecret`
    // appears here once, then again only in the response body.
    secret = { clientId: minted.clientId, clientSecret: minted.clientSecret };
  } catch (err) {
    return zitadelErrorResponse('addMachineSecret', err);
  }

  try {
    await zitadelClient.addProjectMember({
      projectId: agentProjectId(),
      userId: machineUserId,
      roles: [AGENT_PROJECT_ROLE],
    });
  } catch (err) {
    // The machine user + secret already exist; failing here leaves a
    // half-provisioned identity that the next admin retry will fail on
    // (username collision). We surface the failure but log a clear note
    // so an operator can clean up via the Zitadel console.
    console.error(
      '[agents/register] addProjectMember failed; orphaned machine user:',
      machineUserId,
      (err as Error).message,
    );
    return zitadelErrorResponse('addProjectMember', err);
  }

  // Step 5 — assemble response. The pre-filled enroll command is built
  // here so the dashboard never has to know the public Envoy URL.
  const gibsonUrl = envoyPublicUrl();
  const enrollCommand = [
    'gibson-cli agent enroll',
    `--client-id ${secret.clientId}`,
    `--client-secret ${secret.clientSecret}`,
    `--gibson-url ${gibsonUrl}`,
  ].join(' ');

  const body: RegisterAgentResponseBody = {
    clientId: secret.clientId,
    clientSecret: secret.clientSecret,
    gibsonUrl,
    enrollCommand,
  };

  return NextResponse.json(body, {
    status: 201,
    // Defence-in-depth: forbid any cache layer (browser, CDN, edge) from
    // ever storing the credential payload.
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Zitadel API failure into a sanitized HTTP response. The
 * Zitadel error message is included verbatim — `ZitadelApiError`
 * already guarantees no PAT or password leaks. Generic errors are
 * collapsed to a 502 with no internal detail.
 */
function zitadelErrorResponse(stage: string, err: unknown): NextResponse {
  if (err instanceof ZitadelApiError) {
    console.error(
      `[agents/register] zitadel ${stage} failed: HTTP ${err.httpStatus} [${err.zitadelErrorId}] ${err.zitadelErrorMessage}`,
    );
    if (err.httpStatus === 409) {
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
    return NextResponse.json(
      {
        error: {
          code: 'ZITADEL_FAILED',
          message: `Identity provider error during ${stage}`,
        },
      },
      { status: 502 },
    );
  }
  console.error(`[agents/register] unexpected ${stage} failure:`, (err as Error)?.name ?? typeof err);
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
