/**
 * Validator for the customer-supplied ("BYO") Vault address.
 *
 * WHY THIS EXISTS
 * ---------------
 * The BYO Vault address is submitted by a tenant admin through the
 * /settings/secrets-backend form and is then dialled by the daemon while
 * carrying that tenant's Vault token (or AppRole secret ID). An address the
 * platform accepts without checking is therefore two things at once:
 *
 *  1. a credential-exfiltration channel, because the token travels to
 *     whatever host the address names, and
 *  2. a request oracle onto the platform's own internal network, because the
 *     dial originates inside the cluster.
 *
 * This module rejects the obviously hostile shapes at the point of entry.
 *
 * SCOPE AND LIMITS (READ BEFORE RELYING ON THIS)
 * ----------------------------------------------
 * This is a URL-shape check. It runs once, on the string, at submit time.
 * It does NOT and CANNOT stop:
 *
 *  - DNS rebinding: a public hostname that resolves to a public address here
 *    and to 169.254.169.254 (or a cluster IP) at dial time.
 *  - HTTP redirects: a permitted host that answers 302 to an internal URL.
 *  - Any address supplied through a path that does not call this function.
 *
 * The deciding control is connect-time validation on the dial itself, in the
 * daemon: a `net.Dialer` `Control` hook that inspects the resolved address of
 * every connection attempt, including redirect follow-ups. That lives in
 * gibson (`internal/infra/netguard`). This module is defense in depth and
 * usability (it gives the admin an immediate, specific error), not the fix.
 *
 * @module lib/validators/vault-address
 */

/** Longest address string accepted, matching the daemon's own field cap. */
export const MAX_VAULT_ADDRESS_LENGTH = 512;

/**
 * Structured outcome. `reason` is safe to render in the form: it never echoes
 * back anything the daemon said and never contains credential material.
 */
export type VaultAddressValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Host deny lists
// ---------------------------------------------------------------------------

/**
 * Suffixes that only ever name something inside a cluster or a local network.
 * Compared against the lower-cased hostname with any trailing dot removed.
 */
const INTERNAL_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".svc",
  ".cluster.local",
] as const;

/** Exact hostnames that are never a legitimate customer Vault. */
const INTERNAL_HOST_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

// ---------------------------------------------------------------------------
// IP-literal classification
// ---------------------------------------------------------------------------

/**
 * True when `host` is a dotted-quad IPv4 literal in a range that is not
 * routable on the public internet, or is otherwise reserved.
 *
 * The WHATWG URL parser normalizes every IPv4 spelling (octal `0177.0.0.1`,
 * hex `0x7f.0.0.1`, dword `2130706433`) into dotted-quad before this is
 * reached, so the obfuscated forms are covered without special-casing them.
 */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n > 255) return false;
    octets.push(n);
  }
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments / 192.0.2.0/24
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // RFC2544 benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

/**
 * True when `host` (already stripped of its `[]` brackets) is an IPv6 literal
 * that must not be dialled: loopback, unspecified, unique-local, link-local,
 * or an IPv4-mapped/compatible form wrapping a blocked IPv4.
 */
function isBlockedIpv6(host: string): boolean {
  const lower = host.toLowerCase();

  // An IPv4-mapped ("::ffff:127.0.0.1") or IPv4-compatible form: re-check the
  // embedded IPv4 with the IPv4 rules rather than trusting the wrapper.
  const embedded = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded && isBlockedIpv4(embedded[1])) return true;

  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:") || lower.startsWith("::")) return true;

  const firstGroup = lower.split(":")[0];
  if (firstGroup.length === 0) return true;
  const value = parseInt(firstGroup, 16);
  if (Number.isNaN(value)) return true;

  // fc00::/7 unique-local.
  if ((value & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local.
  if ((value & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast.
  if ((value & 0xff00) === 0xff00) return true;

  return false;
}

/** Detects a bracketed IPv6 hostname as produced by the URL parser. */
function isIpv6Literal(hostname: string): boolean {
  return hostname.startsWith("[") && hostname.endsWith("]");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a customer-supplied Vault address.
 *
 * Accepted: an absolute `https://` URL naming a fully-qualified public host,
 * with no embedded credentials, no query and no fragment.
 *
 * On `http`
 * ---------
 * Plain `http` is rejected unconditionally, with no environment escape hatch.
 * The address is dialled *with the tenant's Vault token in the request*, so
 * `http` puts a long-lived credential on the wire in cleartext for every
 * probe and every subsequent read. A BYO Vault is by definition a system the
 * platform reaches across a network boundary it does not control, so there is
 * no deployment in which cleartext here is acceptable. An operator running
 * Vault without TLS should use the hosted broker instead. Note also that the
 * plausible-sounding "but it's http on the internal network" case is exactly
 * the SSRF target this validator exists to refuse.
 *
 * @param raw - The address exactly as submitted.
 * @returns `{ ok: true, normalized }` with the parsed origin-form address, or
 *   `{ ok: false, reason }` with a message safe to display to the admin.
 */
export function validateVaultAddress(raw: string): VaultAddressValidation {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "Vault address is required." };
  }
  if (trimmed.length > MAX_VAULT_ADDRESS_LENGTH) {
    return {
      ok: false,
      reason: `Vault address must be at most ${MAX_VAULT_ADDRESS_LENGTH} characters.`,
    };
  }
  // Control characters and whitespace enable request-splitting and header
  // smuggling further down the chain; refuse them outright.
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return {
      ok: false,
      reason: "Vault address must not contain whitespace or control characters.",
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: "Vault address must be an absolute https:// URL.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        "Vault address must use https. The address is contacted with your Vault credential, so plaintext http is not accepted.",
    };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return {
      ok: false,
      reason: "Vault address must not embed a username or password.",
    };
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    return {
      ok: false,
      reason: "Vault address must not contain a query string or fragment.",
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0) {
    return { ok: false, reason: "Vault address must name a host." };
  }

  if (isIpv6Literal(hostname)) {
    if (isBlockedIpv6(hostname.slice(1, -1))) {
      return {
        ok: false,
        reason:
          "Vault address must not point at a loopback, link-local or private-network address.",
      };
    }
  } else if (isBlockedIpv4(hostname)) {
    return {
      ok: false,
      reason:
        "Vault address must not point at a loopback, link-local or private-network address.",
    };
  }

  if (INTERNAL_HOST_EXACT.has(hostname)) {
    return {
      ok: false,
      reason: "Vault address must not point at an internal or metadata host.",
    };
  }

  for (const suffix of INTERNAL_HOST_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        ok: false,
        reason: "Vault address must not point at an internal or metadata host.",
      };
    }
  }

  // A single-label host (`vault`, `gibson`, `openbao`) is resolved through the
  // pod's search domains and therefore names an in-cluster Service. Requiring
  // a dot also rules out the bare-number hostnames the URL parser leaves
  // alone when they are not valid IPv4.
  const isIpLiteral = isIpv6Literal(hostname) || /^\d+(\.\d+){3}$/.test(hostname);
  if (!isIpLiteral && !hostname.includes(".")) {
    return {
      ok: false,
      reason: "Vault address must name a fully-qualified host.",
    };
  }

  // Re-serialise from the parsed URL so the daemon receives a normalized form
  // rather than the raw operator input.
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return { ok: true, normalized: `${url.protocol}//${url.host}${path}` };
}
