/**
 * Prometheus scrape endpoint.
 *
 * Returns the process-wide metrics registry in Prometheus text exposition
 * format 0.0.4. Access is gated by EITHER a valid SPIFFE JWT-SVID Bearer
 * token (same trust path as `/api/admin/provisioning/*`) OR a source IP
 * that falls inside one of the CIDR blocks listed in the
 * `DASHBOARD_METRICS_ALLOWED_CIDRS` environment variable (comma-separated).
 *
 * Either check alone is sufficient — the SPIFFE path covers in-cluster
 * scrapes from the Prometheus pod that ships a SPIRE agent, while the CIDR
 * path covers Prometheus deployments without SPIFFE identity (e.g. a
 * kube-prometheus-stack chart running in a different namespace).
 *
 * Both checks fail-closed: a 401 response body with no metrics. There is
 * no CORS on this route (it's not a browser-reachable surface) and no
 * response caching (metrics must always reflect the current process).
 *
 * Env:
 *   DASHBOARD_METRICS_ALLOWED_CIDRS   Comma-separated list of IPv4/IPv6
 *                                     CIDR blocks. Unset/empty means the
 *                                     CIDR path is disabled; SPIFFE is
 *                                     the only way in.
 *   SPIFFE_JWKS_URL, SPIFFE_TRUST_DOMAIN, DASHBOARD_ADMIN_AUDIENCE,
 *   ALLOWED_ADMIN_SPIFFE_IDS          See src/lib/spiffe-verifier.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isIP } from "node:net";

import { registry } from "@/src/lib/metrics/registry";
import { verifySpiffeBearer } from "@/src/lib/spiffe-verifier";

// Force this route onto the Node.js runtime: prom-client uses Node APIs
// (perf_hooks, process memory probing for some collectors) and jose's JWT
// verify path runs Node crypto primitives, both of which are unavailable
// under the edge runtime.
export const runtime = "nodejs";

// Disable all caching layers. The scraper must see live values.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Prometheus 0.0.4 text-format Content-Type per the exposition spec.
 * Scrapers key off the `version=0.0.4` parameter.
 */
const PROM_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

// ---------------------------------------------------------------------------
// CIDR parsing & matching
//
// IPv4 addresses fit in a 32-bit unsigned integer — we keep them as plain
// JS `number` and use `>>> 0` to force unsigned 32-bit arithmetic where
// needed (the sign bit otherwise flips for 128.0.0.0/1 and above). IPv6
// is stored as a 16-byte Uint8Array; bitwise ops run byte-at-a-time.
// This avoids BigInt literals which require ES2020+ (dashboard currently
// targets ES2017).
// ---------------------------------------------------------------------------

type ParsedCidr =
  | { family: 4; network: number; prefix: number }
  | { family: 6; network: Uint8Array; prefix: number };

/**
 * Build a 32-bit IPv4 netmask as an unsigned integer. `prefix` in [0, 32].
 * Returns 0 when prefix is 0 (no host bits to mask) so the caller's
 * `(ip & mask)` collapses to zero.
 */
function ipv4Mask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  // Shift by (32 - prefix) with unsigned semantics.
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function ipv4ToNumber(addr: string): number | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let ip = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    ip = ((ip << 8) | n) >>> 0;
  }
  return ip;
}

function ipv6ToBytes(addr: string): Uint8Array | null {
  // Expand "::" and split. Node's isIP already validated the shape.
  let head: string;
  let tail: string;
  if (addr.includes("::")) {
    const parts = addr.split("::");
    head = parts[0] ?? "";
    tail = parts[1] ?? "";
  } else {
    head = addr;
    tail = "";
  }
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - (headGroups.length + tailGroups.length);
  if (missing < 0) return null;
  const groups: string[] = [
    ...headGroups,
    ...Array<string>(missing).fill("0"),
    ...tailGroups,
  ];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(groups[i]!, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

function applyV6Mask(bytes: Uint8Array, prefix: number): void {
  for (let i = 0; i < 16; i++) {
    const bitsHere = Math.max(0, Math.min(8, prefix - i * 8));
    const mask = bitsHere === 0 ? 0 : (0xff << (8 - bitsHere)) & 0xff;
    bytes[i] = bytes[i]! & mask;
  }
}

/**
 * Parse a single "a.b.c.d/N" or "::1/128" entry. Returns null when malformed
 * so the caller can skip and log; we do not throw out of the allow-list
 * loader because a single typo must not wedge the entire gate.
 */
function parseCidr(entry: string): ParsedCidr | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash < 0) return null;
  const addr = trimmed.slice(0, slash);
  const prefixStr = trimmed.slice(slash + 1);
  if (!addr || !prefixStr) return null;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0) return null;

  const family = isIP(addr);
  if (family === 4) {
    if (prefix > 32) return null;
    const ip = ipv4ToNumber(addr);
    if (ip === null) return null;
    return { family: 4, network: (ip & ipv4Mask(prefix)) >>> 0, prefix };
  }
  if (family === 6) {
    if (prefix > 128) return null;
    const bytes = ipv6ToBytes(addr);
    if (!bytes) return null;
    applyV6Mask(bytes, prefix);
    return { family: 6, network: bytes, prefix };
  }
  return null;
}

function matchesCidr(ip: string, cidr: ParsedCidr): boolean {
  const family = isIP(ip);
  if (family !== cidr.family) return false;
  if (cidr.family === 4) {
    const ipNum = ipv4ToNumber(ip);
    if (ipNum === null) return false;
    return ((ipNum & ipv4Mask(cidr.prefix)) >>> 0) === cidr.network;
  }
  const ipBytes = ipv6ToBytes(ip);
  if (!ipBytes) return false;
  applyV6Mask(ipBytes, cidr.prefix);
  const net = cidr.network;
  for (let i = 0; i < 16; i++) {
    if (ipBytes[i] !== net[i]) return false;
  }
  return true;
}

/**
 * Parse `DASHBOARD_METRICS_ALLOWED_CIDRS` once per request. Returns [] when
 * unset/empty — callers treat that as "CIDR gate disabled". Malformed entries
 * are skipped silently (logged to stderr once per request to aid debugging
 * without filling Loki on every scrape).
 */
function loadAllowedCidrs(): ParsedCidr[] {
  const raw = process.env.DASHBOARD_METRICS_ALLOWED_CIDRS ?? "";
  if (!raw.trim()) return [];
  const out: ParsedCidr[] = [];
  for (const entry of raw.split(",")) {
    const parsed = parseCidr(entry);
    if (parsed) {
      out.push(parsed);
    } else if (entry.trim()) {
      // One-line warn; never throw — bad config shouldn't hide metrics
      // availability from a correctly-configured scraper on the same gate.
      // eslint-disable-next-line no-console
      console.warn(
        `[metrics] DASHBOARD_METRICS_ALLOWED_CIDRS: skipping malformed entry "${entry.trim()}"`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client-IP extraction
// ---------------------------------------------------------------------------

/**
 * Collect candidate client IPs from `X-Forwarded-For` and `X-Real-IP`. The
 * left-most XFF entry is the original client per the de-facto proxy
 * convention; we still test every entry against the allow-list so a
 * multi-hop scraper path continues to match.
 *
 * NOTE: These headers are trustworthy only when set by an ingress we
 * control. In a public-ingress deployment the chart MUST terminate and
 * rewrite these headers at the edge — otherwise any caller can spoof
 * `X-Forwarded-For: <whitelisted-ip>`. The SPIFFE path exists precisely
 * so operators who can't guarantee that do not need the CIDR gate.
 */
function extractClientIps(req: NextRequest): string[] {
  const ips: string[] = [];
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    for (const raw of xff.split(",")) {
      const s = raw.trim();
      if (s && isIP(s) !== 0) ips.push(s);
    }
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) {
    const s = xri.trim();
    if (s && isIP(s) !== 0) ips.push(s);
  }
  return ips;
}

function isAllowedCidr(req: NextRequest, cidrs: ParsedCidr[]): boolean {
  if (cidrs.length === 0) return false;
  const ips = extractClientIps(req);
  if (ips.length === 0) return false;
  for (const ip of ips) {
    for (const cidr of cidrs) {
      if (matchesCidr(ip, cidr)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<Response> {
  // 1) SPIFFE Bearer — only attempted when the Authorization header is
  // present, to avoid paying a JWKS round-trip on CIDR-only scrapes.
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    try {
      await verifySpiffeBearer(authHeader);
      return renderMetrics();
    } catch {
      // Fall through to the CIDR gate. If CIDR also fails we return 401
      // at the end; we do not leak the SPIFFE error detail here because
      // a non-SPIFFE scraper shouldn't see SPIFFE-specific messages.
    }
  }

  // 2) CIDR allow-list.
  const cidrs = loadAllowedCidrs();
  if (isAllowedCidr(req, cidrs)) {
    return renderMetrics();
  }

  // Fail closed. Intentionally terse body so an unauthenticated scraper
  // cannot distinguish "CIDR misconfigured" from "SPIFFE rejected".
  return NextResponse.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

async function renderMetrics(): Promise<Response> {
  const body = await registry.metrics();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": PROM_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}
