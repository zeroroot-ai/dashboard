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
 * The singleton survives HMR in dev by memoising on a `globalThis` slot — a
 * fresh `Registry` per hot-reload would throw `A metric with the name ...
 * has already been registered` on the second load of every counter module.
 */

import { Registry } from "prom-client";

// Key used on globalThis; name-spaced to avoid collisions with other libraries
// that also cache state there (e.g. next-auth, @tanstack/query).
const GLOBAL_REGISTRY_KEY = "__gibsonDashboardPromRegistry" as const;

type GlobalWithRegistry = typeof globalThis & {
  [GLOBAL_REGISTRY_KEY]?: Registry;
};

function getOrCreateRegistry(): Registry {
  const g = globalThis as GlobalWithRegistry;
  if (!g[GLOBAL_REGISTRY_KEY]) {
    g[GLOBAL_REGISTRY_KEY] = new Registry();
  }
  return g[GLOBAL_REGISTRY_KEY];
}

/**
 * Process-wide Prometheus registry. Import this from every metrics module
 * and pass it via the `registers` option when constructing Counter/Histogram
 * instances so the `/api/metrics` endpoint exposes them in a single call to
 * `registry.metrics()`.
 */
export const registry: Registry = getOrCreateRegistry();
