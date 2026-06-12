/**
 * SPIFFE/SPIRE Workload API client for the Gibson Dashboard.
 *
 * The SPIRE Agent can be configured to write X.509-SVIDs to disk via the
 * SPIFFE Helper sidecar (spiffe-helper). This module reads those files and
 * exports cert/key/CA Buffers for use in Node.js TLS options.
 *
 * File paths follow the SPIFFE Helper defaults (configurable via environment
 * variables):
 *   SPIFFE_CERT_PATH  , path to the PEM certificate  (default: /run/spire/sockets/svid.pem)
 *   SPIFFE_KEY_PATH   , path to the PEM private key   (default: /run/spire/sockets/svid-key.pem)
 *   SPIFFE_BUNDLE_PATH, path to the PEM trust bundle  (default: /run/spire/sockets/bundle.pem)
 *
 * SVID rotation:
 *   getSVID() always returns the latest in-memory snapshot. A background
 *   fs.watchFile() loop re-reads the cert file whenever it changes (SVID TTL
 *   is typically 1 hour; SPIFFE Helper rewrites the file ~5 minutes before
 *   expiry). The new snapshot is used by the next call to getTransport().
 */

import { readFileSync, watchFile, existsSync } from 'fs';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Configuration, paths resolved from env with defaults
// ---------------------------------------------------------------------------

const CERT_PATH =
  process.env['SPIFFE_CERT_PATH'] ?? '/run/spire/sockets/svid.pem';
const KEY_PATH =
  process.env['SPIFFE_KEY_PATH'] ?? '/run/spire/sockets/svid-key.pem';
const BUNDLE_PATH =
  process.env['SPIFFE_BUNDLE_PATH'] ?? '/run/spire/sockets/bundle.pem';

// ---------------------------------------------------------------------------
// SVID type
// ---------------------------------------------------------------------------

export interface SVID {
  /** PEM-encoded X.509 certificate */
  certificate: Buffer;
  /** PEM-encoded private key */
  privateKey: Buffer;
  /** PEM-encoded trust bundle (CA chain) */
  trustBundle: Buffer;
}

// ---------------------------------------------------------------------------
// In-memory cache and load function
// ---------------------------------------------------------------------------

let _cached: SVID | null = null;
let _watchStarted = false;

/**
 * Load cert/key/bundle from disk into the in-memory cache.
 * Logs a warning and returns null when a file is missing (local dev without
 * a SPIRE Agent, transport falls back to plain TLS without client cert).
 */
function loadSVID(): SVID | null {
  if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH) || !existsSync(BUNDLE_PATH)) {
    console.warn(
      '[spiffe] SVID files not found at expected paths, ' +
        `cert=${CERT_PATH} key=${KEY_PATH} bundle=${BUNDLE_PATH}. ` +
        'Proceeding without mTLS client certificate (local dev mode).'
    );
    return null;
  }
  try {
    const certificate = readFileSync(CERT_PATH);
    const privateKey = readFileSync(KEY_PATH);
    const trustBundle = readFileSync(BUNDLE_PATH);
    return { certificate, privateKey, trustBundle };
  } catch (err) {
    console.error('[spiffe] Failed to read SVID files:', err);
    return null;
  }
}

/**
 * Start a background file watcher that refreshes the cached SVID whenever
 * the certificate file is updated by the SPIFFE Helper sidecar.
 *
 * The watcher is started at most once per process lifetime (idempotent).
 */
function startRotationWatcher(): void {
  if (_watchStarted) return;
  if (!existsSync(CERT_PATH)) return; // No file, nothing to watch yet.

  _watchStarted = true;

  watchFile(CERT_PATH, { interval: 30_000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return; // No change.
    const fresh = loadSVID();
    if (fresh) {
      _cached = fresh;
      logger.info({ component: 'spiffe' }, 'SVID rotated, new certificate loaded');
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the X.509-SVID from the paths written by the SPIFFE Helper sidecar.
 *
 * This is the explicit entry point used by gibson-client.ts on module init.
 * It is safe to call multiple times, results are cached.
 *
 * @param socketPath - Ignored in the file-based implementation. Present for
 *   interface compatibility with the design spec which mentions the Workload
 *   API socket path. A future upgrade could replace this with a gRPC client
 *   if the spiffe-js library adds Node.js Workload API support.
 */
export function readSVIDFromWorkloadAPI(_socketPath?: string): SVID | null {
  if (_cached) return _cached;
  _cached = loadSVID();
  startRotationWatcher();
  return _cached;
}

/**
 * Return the current in-memory SVID snapshot.
 *
 * Returns null when running outside a SPIRE-attested pod (local dev).
 * The transport in gibson-client.ts must handle the null case.
 */
export function getSVID(): SVID | null {
  return readSVIDFromWorkloadAPI();
}
