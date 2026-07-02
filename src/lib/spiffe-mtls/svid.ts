/**
 * SPIFFE X.509-SVID client for outbound dashboard → Envoy mTLS.
 *
 * Spec: unified-identity-and-authorization Phase 4 (R2.5, R9.12).
 *
 * Scope:
 *   - This module is for in-cluster, server-to-server traffic only:
 *     dashboard pod → Envoy upstream cluster.
 *   - Browser → dashboard remains plain HTTPS (cert-manager-issued
 *     leaf cert at the public edge).
 *   - JWT-SVID minting (the deleted `src/lib/spiffe/jwt-svid.ts`) is a
 *     different concern and is NOT being reintroduced here. Subject
 *     identity for service-acting RPCs is now Zitadel client_credentials.
 *
 * Operational behaviour:
 *   - On import, no socket is opened, no env is read, nothing is
 *     stateful. All side effects are deferred to first call.
 *   - {@link isSpiffeAvailable} returns true iff the Workload API socket
 *     resolves on disk (cheap `fs.existsSync`). Local dev returns false.
 *   - {@link getX509SvidContext} fetches an X509-SVID via the SPIRE
 *     Workload API and caches the resulting `tls.SecureContextOptions`.
 *     The cache is rotated at 80% of the leaf cert's lifetime so the
 *     next caller already holds a fresh context.
 *
 * Failure modes:
 *   - Socket missing → {@link NoSpiffeAvailableError}. Callers MUST
 *     handle this and fall back to plain HTTPS with a one-time WARN
 *     log naming `SPIFFE_ENDPOINT_SOCKET`.
 *   - Workload API timeout / malformed response → propagated as the
 *     underlying error; the cache is not poisoned.
 *
 * Security:
 *   - The private key bytes leave this module only inside the
 *     SecureContextOptions value handed to the consumer; they are never
 *     stringified, logged, or serialised to disk.
 */

import 'server-only';

import { existsSync } from 'node:fs';
import type { SecureContextOptions } from 'node:tls';
import { X509Certificate } from 'node:crypto';

import grpc from '@grpc/grpc-js';

// ---------------------------------------------------------------------------
// Public errors
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link getX509SvidContext} when the SPIFFE Workload API
 * socket is not present on disk. This is the typical local-dev shape;
 * callers must handle it and fall back to plain HTTPS.
 */
export class NoSpiffeAvailableError extends Error {
  /** The (resolved) socket path that was probed. */
  readonly socketPath: string;
  constructor(socketPath: string) {
    super(
      `SPIFFE Workload API socket not present at "${socketPath}". ` +
        'Set SPIFFE_ENDPOINT_SOCKET to the SPIRE agent socket, or accept the ' +
        'plain-HTTPS fallback (typical for local dev).',
    );
    this.name = 'NoSpiffeAvailableError';
    this.socketPath = socketPath;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_SOCKET = 'unix:///run/spire/agent-sockets/api.sock';

/** SPIRE requires this metadata key on every Workload API call. */
const WORKLOAD_API_METADATA_KEY = 'workload.spiffe.io';

/**
 * Refresh window. The leaf cert's lifetime is bounded by the SPIRE
 * agent (typically ≤ 1 hour). At 80% of that lifetime we refetch so a
 * mid-flight request never hands an about-to-expire context to the TLS
 * stack.
 */
const REFRESH_AT_FRACTION = 0.8;

/**
 * Read the configured socket. Lazily resolved on every call so tests
 * can override `SPIFFE_ENDPOINT_SOCKET` per case without module-load
 * caching getting in the way.
 */
function configuredSocket(): string {
  return process.env.SPIFFE_ENDPOINT_SOCKET ?? DEFAULT_SOCKET;
}

/**
 * Strip the `unix://` (or `unix:`) prefix to get the filesystem path
 * `fs.existsSync` understands. SPIRE accepts both `unix:` and `unix://`
 * forms; we normalise here.
 */
function socketFsPath(uri: string): string {
  if (uri.startsWith('unix://')) return uri.slice('unix://'.length);
  if (uri.startsWith('unix:')) return uri.slice('unix:'.length);
  return uri;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true iff the SPIFFE Workload API socket is present on disk.
 *
 * Cheap (single `fs.existsSync`); callers can call this on every
 * outbound dial without measurable overhead.
 */
export function isSpiffeAvailable(): boolean {
  const path = socketFsPath(configuredSocket());
  try {
    return existsSync(path);
  } catch {
    // existsSync swallows most errors but defensive try/catch keeps a
    // pathological FUSE / permission failure from blowing up the host.
    return false;
  }
}

/**
 * Returns Node `tls.SecureContextOptions` populated from the dashboard
 * pod's current X509-SVID. The result is cached and refreshed at 80%
 * of the leaf cert's lifetime.
 *
 * @throws {NoSpiffeAvailableError} when the configured socket does not
 *   exist on disk. Callers must catch this and fall back to plain
 *   HTTPS (with a WARN log on first occurrence).
 */
export async function getX509SvidContext(): Promise<SecureContextOptions> {
  if (!isSpiffeAvailable()) {
    throw new NoSpiffeAvailableError(socketFsPath(configuredSocket()));
  }

  const cached = cachedContext;
  const now = Date.now();
  if (cached && now < cached.refreshAtMs) {
    return cached.context;
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const fresh = await fetchAndBuildContext();
      cachedContext = fresh;
      return fresh.context;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Synchronous getter for already-cached SVID context. Returns null if
 * nothing has been fetched yet, or if the cached entry is past its
 * refresh window. Callers that need a guaranteed-fresh context must
 * use {@link getX509SvidContext} instead.
 *
 * Used by sync transport builders (Connect-RPC's createGrpcTransport)
 * that can't await: the typical pattern is
 *   `tryGetCachedX509SvidContext() ?? plainTlsOptions`,
 * paired with a fire-and-forget {@link warmX509SvidContext} on startup.
 */
export function tryGetCachedX509SvidContext(): SecureContextOptions | null {
  const cached = cachedContext;
  if (!cached) return null;
  if (Date.now() >= cached.refreshAtMs) return null;
  return cached.context;
}

/**
 * Fire-and-forget warm-up: prefetches the X509-SVID into the cache so
 * the next sync caller of {@link tryGetCachedX509SvidContext} sees a
 * populated entry. Errors are swallowed (logged at WARN), the warm-up
 * is best-effort and never blocks the first outbound RPC.
 */
export function warmX509SvidContext(): void {
  if (!isSpiffeAvailable()) return;
  // Returning the promise into the void operator stops "unhandled
  // promise" warnings without forcing every caller to remember the
  // ".catch(() => {})" pattern.
  void getX509SvidContext().catch((err: unknown) => {
    const name = err instanceof Error ? err.name : 'unknown';
    console.warn(
      `[spiffe-mtls] X509-SVID warm-up failed (${name}); will retry on demand`,
    );
  });
}

// ---------------------------------------------------------------------------
// Module-scoped cache
// ---------------------------------------------------------------------------

interface CachedSvid {
  context: SecureContextOptions;
  /** Epoch ms at which this entry should be refreshed (80% of NotAfter). */
  refreshAtMs: number;
}

let cachedContext: CachedSvid | null = null;
let inFlight: Promise<SecureContextOptions> | null = null;

// ---------------------------------------------------------------------------
// Workload API call
// ---------------------------------------------------------------------------

/**
 * Internal: fetch one X509-SVID from the Workload API and assemble it
 * into a Node `SecureContextOptions` with PEM-encoded fields. The
 * SPIRE agent streams responses; we resolve on the first SVID and
 * close the stream.
 */
async function fetchAndBuildContext(): Promise<CachedSvid> {
  const socket = configuredSocket();
  const svid = await fetchX509SVID(socket);
  return buildContext(svid);
}

/**
 * Convert a raw {@link X509SVIDPayload} into a {@link CachedSvid} with
 * a PEM-bundled SecureContextOptions and a refresh deadline derived
 * from the leaf cert's NotAfter.
 *
 * Exported for tests so they can drive the conversion deterministically
 * without exercising the gRPC stub.
 */
export function buildContext(svid: X509SVIDPayload): CachedSvid {
  if (svid.x509Svid.length === 0 || svid.x509SvidKey.length === 0 || svid.bundle.length === 0) {
    throw new Error('SPIFFE X509-SVID is missing cert, key, or bundle bytes');
  }

  // The `x509_svid` field is the leaf followed by any intermediates
  // concatenated in DER. We split per-cert and re-encode each as PEM
  // so Node's TLS stack can consume the chain. The trust bundle is
  // similarly DER-concatenated, same treatment.
  const certPem = derChainToPem(svid.x509Svid, 'CERTIFICATE');
  const caPem = derChainToPem(svid.bundle, 'CERTIFICATE');
  const keyPem = derToPem(svid.x509SvidKey, 'PRIVATE KEY');

  const refreshAtMs = computeRefreshAtMs(svid.x509Svid);

  const context: SecureContextOptions = {
    cert: certPem,
    key: keyPem,
    ca: caPem,
    // Force TLS 1.3 minimum to match the rest of the spec's posture
    // (NFR Security: "All TLS connections SHALL use TLS 1.3").
    minVersion: 'TLSv1.3',
  };

  return { context, refreshAtMs };
}

/**
 * Compute the refresh deadline for an SVID. The leaf cert's NotAfter
 * is the absolute upper bound; we refetch at 80% of (NotAfter - now)
 * so a steady stream of callers never observes an expired context.
 *
 * Falls back to a 60-minute default if the cert is unparseable, this
 * shouldn't happen in practice (SPIRE always emits a valid X.509) but
 * we'd rather refetch too often than serve stale state.
 */
function computeRefreshAtMs(leafDer: Uint8Array): number {
  try {
    // X509Certificate accepts a Buffer of DER bytes directly.
    const cert = new X509Certificate(Buffer.from(leafDer));
    const notAfter = new Date(cert.validTo).getTime();
    if (!Number.isFinite(notAfter) || notAfter <= Date.now()) {
      return Date.now() + 60_000; // refresh in a minute on a bad cert
    }
    const remaining = notAfter - Date.now();
    return Date.now() + Math.floor(remaining * REFRESH_AT_FRACTION);
  } catch {
    return Date.now() + 60 * 60_000;
  }
}

// ---------------------------------------------------------------------------
// PEM helpers
// ---------------------------------------------------------------------------

/**
 * Encode a single block of DER bytes as PEM. Used for the private key.
 */
function derToPem(der: Uint8Array, label: string): string {
  const b64 = Buffer.from(der).toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * SPIRE sometimes packs multiple certs (leaf + intermediates / trust
 * bundle entries) back-to-back in DER. Walk the byte stream, splitting
 * on each `SEQUENCE` boundary, and emit one PEM block per cert.
 *
 * The DER `SEQUENCE` tag is `0x30` followed by a length encoding (X.690
 * §8.1.3): if the high bit of the first length byte is clear, that byte
 * IS the length (short form, ≤ 127); otherwise the lower 7 bits give the
 * number of subsequent length bytes (long form). We only handle the
 * short and long forms used by valid X.509, indefinite length is not
 * permitted in DER.
 */
function derChainToPem(chain: Uint8Array, label: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < chain.length) {
    if (chain[i] !== 0x30) {
      throw new Error(`SPIFFE chain: unexpected byte 0x${chain[i]!.toString(16)} at offset ${i}`);
    }
    const lenStart = i + 1;
    if (lenStart >= chain.length) {
      throw new Error('SPIFFE chain: truncated length field');
    }
    const first = chain[lenStart]!;
    let headerLen: number;
    let contentLen: number;
    if ((first & 0x80) === 0) {
      headerLen = 2;
      contentLen = first;
    } else {
      const numLenBytes = first & 0x7f;
      if (numLenBytes === 0 || numLenBytes > 4) {
        throw new Error('SPIFFE chain: unsupported DER length form');
      }
      headerLen = 2 + numLenBytes;
      if (lenStart + 1 + numLenBytes > chain.length) {
        throw new Error('SPIFFE chain: truncated long-form length');
      }
      contentLen = 0;
      for (let b = 0; b < numLenBytes; b++) {
        contentLen = (contentLen << 8) | chain[lenStart + 1 + b]!;
      }
    }
    const totalLen = headerLen + contentLen;
    if (i + totalLen > chain.length) {
      throw new Error('SPIFFE chain: SEQUENCE overruns buffer');
    }
    out.push(derToPem(chain.subarray(i, i + totalLen), label));
    i += totalLen;
  }
  if (out.length === 0) {
    throw new Error('SPIFFE chain: no certificates found');
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Workload API gRPC client (FetchX509SVID, server-streaming)
// ---------------------------------------------------------------------------
//
// Proto:
//   rpc FetchX509SVID(X509SVIDRequest) returns (stream X509SVIDResponse);
//
//   message X509SVIDRequest {}    // empty
//   message X509SVID {
//     string spiffe_id     = 1;
//     bytes  x509_svid     = 2;   // leaf (+ intermediates), DER
//     bytes  x509_svid_key = 3;   // PKCS#8 private key, DER
//     bytes  bundle        = 4;   // trust bundle, DER (one or more certs)
//     // hint = 5, ignored
//   }
//   message X509SVIDResponse {
//     repeated X509SVID svids = 1;
//     map<string, bytes> federated_bundles = 2; // ignored
//     repeated string crl = 3;                   // ignored
//   }
//
// We hand-roll the proto3 wire encoding because the dashboard already
// avoided pulling in a runtime proto loader for the (now-deleted)
// JWT-SVID fetcher; the same constraint applies here.

/** Public payload type, the bytes the SPIRE agent returns for one SVID. */
export interface X509SVIDPayload {
  spiffeId: string;
  /** Leaf cert (and any intermediates), DER-encoded back-to-back. */
  x509Svid: Uint8Array;
  /** Private key, PKCS#8 DER. */
  x509SvidKey: Uint8Array;
  /** Trust bundle, DER (one or more certs back-to-back). */
  bundle: Uint8Array;
}

/** Read a varint from `buf` at position; return [value, next pos]. */
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

/** Decode a proto3 X509SVID message. */
function decodeX509SVID(buf: Buffer): X509SVIDPayload {
  let pos = 0;
  let spiffeId = '';
  let x509Svid = new Uint8Array(0);
  let x509SvidKey = new Uint8Array(0);
  let bundle = new Uint8Array(0);
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;
    if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const slice = buf.subarray(pos, pos + len);
      pos += len;
      if (fieldNumber === 1) spiffeId = slice.toString('utf8');
      else if (fieldNumber === 2) x509Svid = new Uint8Array(slice);
      else if (fieldNumber === 3) x509SvidKey = new Uint8Array(slice);
      else if (fieldNumber === 4) bundle = new Uint8Array(slice);
    } else if (wireType === 0) {
      const [, p2] = readVarint(buf, pos);
      pos = p2;
    } else {
      // 32-bit / 64-bit / unknown, give up rather than misinterpret.
      break;
    }
  }
  return { spiffeId, x509Svid, x509SvidKey, bundle };
}

/** Decode the X509SVIDResponse and return its first SVID. */
function decodeX509SVIDResponse(buf: Buffer): X509SVIDPayload | null {
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;
    if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const slice = buf.subarray(pos, pos + len);
      pos += len;
      if (fieldNumber === 1) {
        return decodeX509SVID(slice);
      }
      // field 2 (federated_bundles map) and field 3 (crl), skip.
    } else if (wireType === 0) {
      const [, p2] = readVarint(buf, pos);
      pos = p2;
    } else {
      break;
    }
  }
  return null;
}

const WORKLOAD_API_METHODS = {
  FetchX509SVID: {
    path: '/SpiffeWorkloadAPI/FetchX509SVID',
    originalName: 'FetchX509SVID',
    requestStream: false,
    responseStream: true,
    // X509SVIDRequest is the empty message, encode to zero bytes.
    requestSerialize: (_req: Record<string, never>): Buffer => Buffer.alloc(0),
    requestDeserialize: (_buf: Buffer): Record<string, never> => ({}),
    responseSerialize: (_res: X509SVIDPayload): Buffer => Buffer.alloc(0),
    responseDeserialize: (buf: Buffer): X509SVIDPayload | null =>
      decodeX509SVIDResponse(buf),
  },
} as const;

/**
 * Fetch one X509-SVID from the SPIRE agent's Workload API. Resolves on
 * the first streamed response; cancels the stream right after.
 *
 * Exported for tests; production callers should use
 * {@link getX509SvidContext} which adds caching + PEM assembly.
 */
export async function fetchX509SVID(
  socketPath: string,
  timeoutMs = 5_000,
): Promise<X509SVIDPayload> {
  return new Promise<X509SVIDPayload>((resolve, reject) => {
    const ClientCtor = grpc.makeGenericClientConstructor(
      WORKLOAD_API_METHODS as unknown as Parameters<typeof grpc.makeGenericClientConstructor>[0],
      'SpiffeWorkloadAPI',
      {},
    );
    const client = new ClientCtor(
      socketPath,
      grpc.credentials.createInsecure(),
      {
        'grpc.enable_retries': 0,
        'grpc.keepalive_time_ms': 10_000,
        'grpc.keepalive_timeout_ms': 5_000,
      },
    );

    const meta = new grpc.Metadata();
    meta.set(WORKLOAD_API_METADATA_KEY, 'true');

    const deadline = new Date(Date.now() + timeoutMs);

    const call = (
      client as unknown as {
        FetchX509SVID: (
          req: Record<string, never>,
          meta: grpc.Metadata,
          opts: grpc.CallOptions,
        ) => grpc.ClientReadableStream<X509SVIDPayload | null>;
      }
    ).FetchX509SVID({}, meta, { deadline });

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        call.cancel();
      } catch {
        // best-effort; the stream is going away regardless
      }
      try {
        client.close();
      } catch {
        // best-effort
      }
      fn();
    };

    call.on('data', (msg: X509SVIDPayload | null) => {
      if (!msg) {
        settle(() => reject(new Error('SPIFFE Workload API returned empty SVID list')));
        return;
      }
      settle(() => resolve(msg));
    });
    call.on('error', (err: Error) => {
      settle(() => reject(err));
    });
    call.on('end', () => {
      settle(() => reject(new Error('SPIFFE Workload API stream ended without an SVID')));
    });
  });
}

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

/**
 * Drop the cached SVID and any in-flight refresh. Vitest cases call
 * this between assertions so each test starts with a cold cache.
 * Production code MUST NOT call this, the cache is sized correctly
 * for the pod's lifetime.
 */
export function __resetForTests(): void {
  cachedContext = null;
  inFlight = null;
}
