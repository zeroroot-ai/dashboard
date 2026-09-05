/**
 * Service-account identity resolver, readable-name lookup for log enrichment.
 *
 * Spec: canonical-service-identity Req 8.
 *
 * The canonical service-account identifier across the platform is the
 * Zitadel-issued numeric `sub`. Auth decisions everywhere use that numeric
 * form. This helper provides the reverse mapping (numeric → readable SA
 * name like "gibson-tenant-operator") for one purpose only: making log
 * lines and audit trails human-readable.
 *
 * INVARIANT: this module MUST NEVER appear in an auth-decision code path.
 * It is for display only. A vitest visibility guard pins importer paths
 * to log/audit code (see __tests__/identity-resolver.visibility.test.ts).
 *
 * Source-of-truth: gibson-sa-identity-map ConfigMap, projected into the
 * dashboard pod by the resolve-sa-identity-map init container as a JSON
 * file at SA_IDENTITY_MAP_PATH (default /shared/sa-identity-map.json).
 *
 * @module auth/identity-resolver
 */

import 'server-only';
import { closeSync, fstatSync, openSync, readFileSync, watchFile } from 'node:fs';

type IdentityMap = Record<string, string>;

const DEFAULT_PATH = '/shared/sa-identity-map.json';
const REFRESH_INTERVAL_MS = 60_000;

let cache: IdentityMap = {};
let cacheMtimeMs = 0;
let watcherArmed = false;

function mapPath(): string {
  return process.env.SA_IDENTITY_MAP_PATH ?? DEFAULT_PATH;
}

function loadIfChanged(): void {
  // Open once, then fstat and read through that SAME descriptor.
  //
  // The previous form resolved the path twice — statSync(path) to read the
  // mtime, then readFileSync(path) to get the bytes — so the two calls could
  // land on two different files if the path was replaced in between. That is
  // a time-of-check/time-of-use gap: the mtime recorded in cacheMtimeMs would
  // describe one file while `cache` held the contents of another, and because
  // the mtime then matches on every subsequent call, the stale contents would
  // be pinned indefinitely rather than corrected on the next refresh.
  //
  // A descriptor refers to the opened inode, not to the name, so fstatSync and
  // readFileSync(fd) cannot disagree about which file they are describing.
  let fd: number | undefined;
  try {
    fd = openSync(mapPath(), 'r');
    const m = fstatSync(fd).mtimeMs;
    if (m === cacheMtimeMs) return;
    const raw = readFileSync(fd, 'utf8');
    cache = JSON.parse(raw) as IdentityMap;
    cacheMtimeMs = m;
  } catch {
    // Keep last-known-good cache on read/parse error. The init container
    // fail-fasts if the map is unpopulated, so missing-file at runtime is
    // either a misconfiguration or a node restart in progress.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function ensureWatcher(): void {
  if (watcherArmed) return;
  watcherArmed = true;
  loadIfChanged();
  watchFile(
    mapPath(),
    { persistent: false, interval: REFRESH_INTERVAL_MS },
    loadIfChanged,
  );
}

/**
 * Resolve a numeric Zitadel `sub` to its readable platform-SA name.
 *
 * @param numericSub The decimal-string `sub` claim from a verified JWT.
 * @returns The readable name (e.g. "gibson-tenant-operator") if the sub
 *   belongs to a known platform SA, or `null` for human users / unknown
 *   subs. Callers handle the null case by logging the bare numeric sub.
 */
export function resolveServiceIdentity(numericSub: string): string | null {
  if (!numericSub) return null;
  ensureWatcher();
  // Check mtime on every call, sub-microsecond stat(), and the once-per-60s
  // watchFile poll alone leaves the cache stale for up to a minute after a
  // post-install ConfigMap update propagates into the mounted volume.
  loadIfChanged();
  for (const [readable, num] of Object.entries(cache)) {
    if (num === numericSub) return readable;
  }
  return null;
}

/** Test-only: reset internal cache + watcher state. */
export function __resetIdentityResolverForTests(): void {
  cache = {};
  cacheMtimeMs = 0;
  watcherArmed = false;
}
