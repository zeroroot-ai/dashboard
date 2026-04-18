/**
 * HMR-safe / build-safe metric constructors.
 *
 * prom-client throws `A metric with the name X has already been registered`
 * if the same Counter/Histogram constructor runs twice against a registry.
 * This happens under two legitimate conditions:
 *
 *   1. Next.js dev HMR — modules reload but the globalThis-memoised registry
 *      survives, so the second Counter constructor sees a collision.
 *   2. Next.js production build — `phase-production-build` imports server
 *      modules multiple times while collecting page metadata.
 *
 * `getOrCreateCounter` / `getOrCreateHistogram` look up the metric by name
 * first via `registry.getSingleMetric(name)` and reuse it if present; only
 * on first instantiation do they call the Counter/Histogram constructor.
 *
 * Call sites pass the same config they would have passed to the constructor.
 * The return value is typed as the matching prom-client class so callers get
 * `.inc()`, `.observe()`, and `.labels()` exactly as before.
 */

import {
  Counter,
  Histogram,
  type CounterConfiguration,
  type HistogramConfiguration,
} from "prom-client";

import { registry } from "./registry";

export function getOrCreateCounter<L extends string = string>(
  config: CounterConfiguration<L>,
): Counter<L> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) return existing as Counter<L>;
  return new Counter<L>({ ...config, registers: [registry] });
}

export function getOrCreateHistogram<L extends string = string>(
  config: HistogramConfiguration<L>,
): Histogram<L> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) return existing as Histogram<L>;
  return new Histogram<L>({ ...config, registers: [registry] });
}
