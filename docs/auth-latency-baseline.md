# Auth sign-in latency baseline

Spec: `auth-resolution-hardening`, Task 15a (R8.4).

This document describes the baseline sign-in latency measurement for the
`auth-resolution-hardening` spec and how to re-run it.

## How to re-run

```bash
# 1. Start the dashboard server:
cd enterprise/platform/dashboard
pnpm build && pnpm start
# or for dev:  pnpm dev

# 2. Drive sign-in traffic (the happy-path e2e test populates the histogram):
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  pnpm test:e2e:auth-errors --grep happy_path

# 3. Capture the histogram from /api/metrics:
node scripts/auth-latency-baseline.mjs --base-url http://localhost:3000

# Output is written to enterprise/docs/auth-latency-baseline.json (gitignored).
# The script prints p50/p95/p99 and exits non-zero if the SLO is violated.
```

The JSON output file (`auth-latency-baseline.json`) is gitignored because it
varies per environment and per traffic level. Commit the numbers to this
markdown file instead after each meaningful measurement.

## SLO targets (spec R8)

| Percentile | Target |
|---|---|
| p95 | < 1.5 s |
| p99 | < 3.0 s |

## Baseline measurements

### auth-resolution-hardening pre-FGA-roundtrip baseline

- **Date:** 2026-04-26
- **Environment:** Kind dev cluster (`kind-gibson`), single-node, Zitadel live
  (NodePort 30443), FGA live, dashboard at NodePort 30081.
- **Constraint:** The dashboard `/api/metrics` endpoint requires a SPIFFE JWT-SVID
  or a source IP in `DASHBOARD_METRICS_ALLOWED_CIDRS`. On the Kind cluster the
  Prometheus scrape job does not yet carry a SPIFFE identity for this route
  (`DASHBOARD_METRICS_ALLOWED_CIDRS` is empty in the Helm values). As a result
  the histogram has 0 externally-scrapeable samples even though sign-ins flow
  through the cluster.
- **Resolution path:** To capture baseline numbers, either:
  1. Set `DASHBOARD_METRICS_ALLOWED_CIDRS=10.244.0.0/16,10.96.0.0/12` in the
     Helm values (pod CIDR + service CIDR) and re-deploy, then re-run the
     script from inside the cluster, or
  2. Wire the Prometheus scrape job with a SPIFFE JWT-SVID (future work under
     the SPIFFE scrape spec).
- **p50:** not captured (metrics endpoint auth blocks external scraping)
- **p95:** not captured
- **p99:** not captured

  The `auth-latency-baseline.mjs` script will print a clear message explaining
  the 401 auth constraint when run against the cluster. This is the expected
  behaviour, the guard correctly rejects unauthenticated scrapes.

  The baseline is deferred until `DASHBOARD_METRICS_ALLOWED_CIDRS` is set for
  the Kind cluster or the Prometheus scrape job carries SPIFFE identity.
  The SLO of p95 < 1.5 s is validated by the recording rules once scraping
  is configured.

### Post-deploy production baseline

Re-run this script against production after `dashboard-fga-user-identity`
ships. Update this table with the captured numbers:

| Date | Environment | p50 | p95 | p99 | SLO p95 | SLO p99 |
|---|---|---|---|---|---|---|
| (pending) | kind-gibson |, |, |, | < 1.5s | < 3.0s |
| (pending) | production |, |, |, | < 1.5s | < 3.0s |

## Notes

- The histogram uses prom-client's default label `outcome` (success/error) so
  both happy-path and error-path latencies are tracked separately.
- The `scripts/auth-latency-baseline.mjs` script computes percentiles from the
  cumulative bucket distribution using linear interpolation, the same method
  Prometheus uses for `histogram_quantile()`.
- If p95 exceeds 1.5 s after the FGA roundtrip lands, investigate
  `dashboard_membership_resolution_duration_seconds` first, that is the most
  likely source of added latency.
