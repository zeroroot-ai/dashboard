/**
 * Singleton Prometheus `Registry` for the dashboard process.
 *
 * All dashboard-emitted metrics must register against this registry so the
 * `/api/metrics` route (see `app/api/metrics/route.ts`) can expose them in a
 * single scrape response. Each subsystem (auth, missions, components, ...)
 * owns a sibling file under `src/lib/metrics/` that imports `registry` and
 * registers its own counters/histograms at module load time.
 *
 * We intentionally do NOT call `collectDefaultMetrics` from prom-client here:
 * Node process metrics (heap, event loop lag, GC) are collected by the
 * Kubernetes kubelet and the dedicated OpenTelemetry collector sidecar, not
 * by this endpoint. Keeping the registry lean also bounds the scrape response
 * size on high-replica deployments.
 *
 * The singleton survives HMR in dev by memoising on a `globalThis` slot, a
 * fresh `Registry` per hot-reload would throw `A metric with the name ...
 * has already been registered` on the second load of every counter module.
 *
 * Why prom-client is loaded lazily:
 * Next.js 16 / Turbopack traces static imports through the module graph for
 * every bundle context (Edge Middleware, App Route, Server Component,
 * Client Component SSR). prom-client uses Node-only modules (`cluster`,
 * `fs`, `v8`) and any [Client Component SSR] context that transitively
 * reaches this module fails the build with `Module not found: Can't
 * resolve 'cluster'`. Even `serverExternalPackages: ["prom-client"]` was
 * insufficient, Turbopack's analyser still walked into prom-client's
 * internal files. The `node:module.createRequire` + path-concat pattern
 * keeps prom-client out of the static graph entirely; it loads at runtime
 * in the Node bundle where the primitives exist.
 */

import { createRequire } from "node:module";

// Type-only import so the public `Registry` surface is preserved without
// pulling the runtime module into the static graph.
type Registry = import("prom-client").Registry;

// Key used on globalThis; name-spaced to avoid collisions with other libraries
// that also cache state there (e.g. next-auth, @tanstack/query).
const GLOBAL_REGISTRY_KEY = "__gibsonDashboardPromRegistry" as const;

type GlobalWithRegistry = typeof globalThis & {
  [GLOBAL_REGISTRY_KEY]?: Registry;
};

let cachedRegistry: Registry | null = null;
let cachedFailed = false;

function loadRegistryClass(): { Registry: new () => Registry } | null {
  if (cachedFailed) return null;
  try {
    // String concat hides the path from Turbopack's static analyser.
    const segments = ["prom", "client"];
    const modName = segments.join("-");
    const reqFromHere = createRequire(__filename);
    return reqFromHere(modName) as { Registry: new () => Registry };
  } catch {
    cachedFailed = true;
    return null;
  }
}

function getOrCreateRegistry(): Registry {
  if (cachedRegistry) return cachedRegistry;
  const g = globalThis as GlobalWithRegistry;
  if (g[GLOBAL_REGISTRY_KEY]) {
    cachedRegistry = g[GLOBAL_REGISTRY_KEY];
    return cachedRegistry;
  }
  const mod = loadRegistryClass();
  if (!mod) {
    // Edge / browser context (defensive, this module is server-only by
    // virtue of every caller running server-side, but the lazy fallback
    // ensures we don't crash the bundler in Client Component SSR even if
    // a transitive import accidentally reaches us). Return a no-op proxy
    // so Counter/Histogram constructors that accept `registers: [registry]`
    // don't throw. Anything that actually scrapes /api/metrics runs in
    // the Node.js runtime where the real registry is available.
    const noop = new Proxy({}, { get: () => () => undefined }) as unknown as Registry;
    cachedRegistry = noop;
    return noop;
  }
  cachedRegistry = new mod.Registry();
  g[GLOBAL_REGISTRY_KEY] = cachedRegistry;
  return cachedRegistry;
}

/**
 * Process-wide Prometheus registry. Import this from every metrics module
 * and pass it via the `registers` option when constructing Counter/Histogram
 * instances so the `/api/metrics` endpoint exposes them in a single call to
 * `registry.metrics()`.
 */
export const registry: Registry = getOrCreateRegistry();
