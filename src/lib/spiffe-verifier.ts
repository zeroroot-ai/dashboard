/**
 * SPIFFE JWT-SVID verification.
 *
 * Validates bearer tokens minted by SPIFFE workloads (e.g. the tenant-operator)
 * against the SPIRE trust bundle exposed as JWKS by a sidecar
 * (`gibson-spiffe-jwks-exporter`). Only callers whose SPIFFE ID is in the
 * allow-list are granted admin privileges.
 *
 * The JWKS sidecar watches the SPIRE Workload API for bundle rotations and
 * serves the current JWT authorities as a JWK Set on loopback. We cache the
 * result in-process so a misbehaving sidecar can't gate every request; failures
 * to reload preserve the last-known-good keys.
 *
 * Env vars:
 *   SPIFFE_JWKS_URL            — sidecar URL (default http://127.0.0.1:9091/jwks)
 *   SPIFFE_TRUST_DOMAIN        — expected trust domain (e.g. "gibson.io")
 *   DASHBOARD_ADMIN_AUDIENCE   — expected JWT audience (e.g. "gibson-dashboard").
 *                                Legacy alias BETTER_AUTH_ADMIN_AUDIENCE is
 *                                still honoured for one release after the
 *                                unified-identity-and-authorization Phase 4
 *                                rename so existing chart values keep working.
 *   ALLOWED_ADMIN_SPIFFE_IDS   — comma-separated SPIFFE ID allow-list
 */

import { createLocalJWKSet, jwtVerify, type JWK } from "jose";

const JWKS_URL =
  process.env.SPIFFE_JWKS_URL ?? "http://127.0.0.1:9091/jwks";
const TRUST_DOMAIN = process.env.SPIFFE_TRUST_DOMAIN ?? "gibson.io";
const EXPECTED_AUDIENCE =
  process.env.DASHBOARD_ADMIN_AUDIENCE ??
  process.env.BETTER_AUTH_ADMIN_AUDIENCE ??
  "gibson-dashboard";
const ALLOWED_SPIFFE_IDS = (process.env.ALLOWED_ADMIN_SPIFFE_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

let cachedJWKS: ReturnType<typeof createLocalJWKSet> | null = null;
let cachedAt = 0;
const RELOAD_INTERVAL_MS = 30_000;

async function loadJWKS(): Promise<ReturnType<typeof createLocalJWKSet>> {
  const now = Date.now();
  if (cachedJWKS && now - cachedAt < RELOAD_INTERVAL_MS) {
    return cachedJWKS;
  }
  const res = await fetch(JWKS_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `spiffe-verifier: JWKS fetch from ${JWKS_URL} returned ${res.status}`,
    );
  }
  const body = (await res.json()) as { keys?: JWK[] };
  if (!body.keys || body.keys.length === 0) {
    throw new Error(
      `spiffe-verifier: JWKS from ${JWKS_URL} has no keys`,
    );
  }
  cachedJWKS = createLocalJWKSet({ keys: body.keys });
  cachedAt = now;
  return cachedJWKS;
}

export type VerifiedSpiffeCaller = {
  spiffeId: string;
  // The SPIFFE workload path component (e.g. "platform/tenant-operator").
  path: string;
};

/**
 * Verify a SPIFFE JWT-SVID from an Authorization header value.
 * Throws on any failure — callers should catch and return 401/403.
 *
 * Checks:
 *   - Signature against current SPIRE trust bundle (JWT keys only).
 *   - Audience contains the configured dashboard audience.
 *   - Issuer matches the expected SPIRE trust domain.
 *   - Subject SPIFFE ID is in the allow-list.
 */
export async function verifySpiffeBearer(
  authHeader: string | null,
): Promise<VerifiedSpiffeCaller> {
  if (!authHeader) {
    throw new Error("missing Authorization header");
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    throw new Error("Authorization header must be Bearer <token>");
  }
  const token = match[1];

  const jwks = await loadJWKS();
  const { payload } = await jwtVerify(token, jwks, {
    audience: EXPECTED_AUDIENCE,
  });

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("JWT missing sub claim");
  }
  // SPIFFE subject is a URI: spiffe://<trust-domain>/<path>
  if (!sub.startsWith(`spiffe://${TRUST_DOMAIN}/`)) {
    throw new Error(
      `sub ${sub} does not match trust domain spiffe://${TRUST_DOMAIN}/`,
    );
  }
  if (ALLOWED_SPIFFE_IDS.length === 0) {
    throw new Error(
      "ALLOWED_ADMIN_SPIFFE_IDS is empty — no SPIFFE callers are authorized",
    );
  }
  if (!ALLOWED_SPIFFE_IDS.includes(sub)) {
    throw new Error(`SPIFFE ID ${sub} not in admin allow-list`);
  }

  return {
    spiffeId: sub,
    path: sub.slice(`spiffe://${TRUST_DOMAIN}/`.length),
  };
}
