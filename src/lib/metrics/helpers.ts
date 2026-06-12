/**
 * HMR-safe / build-safe metric constructors.
 *
 * prom-client throws `A metric with the name X has already been registered`
 * if the same Counter/Histogram constructor runs twice against a registry.
 * This happens under two legitimate conditions:
 *
 *   1. Next.js dev HMR, modules reload but the globalThis-memoised registry
 *      survives, so the second Counter constructor sees a collision.
 *   2. Next.js production build, `phase-production-build` imports server
 *      modules multiple times while collecting page metadata.
 *
 * `getOrCreateCounter` / `getOrCreateHistogram` look up the metric by name
 * first via `registry.getSingleMetric(name)` and reuse it if present; only
 * on first instantiation do they call the Counter/Histogram constructor.
 *
 * Call sites pass the same config they would have passed to the constructor.
 * The return value is typed as the matching prom-client class so callers get
 * `.inc()`, `.observe()`, and `.labels()` exactly as before.
 *
 * prom-client is loaded via `node:module.createRequire` at first call so
 * Turbopack doesn't trace its Node-only internals into the static module
 * graph (see registry.ts for the same rationale).
 */

import { createRequire } from "node:module";

import { registry } from "./registry";

// Type-only imports preserve the public API surface without dragging the
// runtime module into the static graph.
type Counter<L extends string = string> = import("prom-client").Counter<L>;
type Histogram<L extends string = string> = import("prom-client").Histogram<L>;
type CounterConfiguration<L extends string = string> = import("prom-client").CounterConfiguration<L>;
type HistogramConfiguration<L extends string = string> = import("prom-client").HistogramConfiguration<L>;
export type { CounterConfiguration, HistogramConfiguration };

interface PromClientCtors {
  Counter: new <L extends string = string>(opts: object) => Counter<L>;
  Histogram: new <L extends string = string>(opts: object) => Histogram<L>;
}

let cachedCtors: PromClientCtors | null = null;
let cachedFailed = false;

function loadPromCtors(): PromClientCtors | null {
  if (cachedCtors) return cachedCtors;
  if (cachedFailed) return null;
  try {
    const segments = ["prom", "client"];
    const modName = segments.join("-");
    const reqFromHere = createRequire(__filename);
    cachedCtors = reqFromHere(modName) as PromClientCtors;
    return cachedCtors;
  } catch {
    cachedFailed = true;
    return null;
  }
}

export function getOrCreateCounter<L extends string = string>(
  config: CounterConfiguration<L>,
): Counter<L> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) return existing as Counter<L>;
  const ctors = loadPromCtors();
  if (!ctors) {
    // Defensive: edge/browser context shouldn't reach here, but if it does,
    // returning a no-op proxy lets callers chain `.inc({...})` without
    // crashing the bundler.
    return new Proxy({}, { get: () => () => undefined }) as unknown as Counter<L>;
  }
  return new ctors.Counter<L>({ ...config, registers: [registry] });
}

export function getOrCreateHistogram<L extends string = string>(
  config: HistogramConfiguration<L>,
): Histogram<L> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) return existing as Histogram<L>;
  const ctors = loadPromCtors();
  if (!ctors) {
    return new Proxy({}, { get: () => () => undefined }) as unknown as Histogram<L>;
  }
  return new ctors.Histogram<L>({ ...config, registers: [registry] });
}
