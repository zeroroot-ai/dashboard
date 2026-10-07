# Auth sign-in latency baseline

Spec: `auth-resolution-hardening`, Task 15a (R8.4).

This document describes the baseline sign-in latency measurement for the
`auth-resolution-hardening` spec and how to re-run it.

## How to re-run

```bash
# 1. Start the dashboard server:
cd <your dashboard checkout>
pnpm build && pnpm start
# or for dev:  pnpm dev

# 2. Drive sign-in traffic (the happy-path e2e test populates the histogram):
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  pnpm test:e2e e2e/auth/login-happy.spec.ts

# 3. Capture the histogram from the metrics-only port (default 9464):
node scripts/auth-latency-baseline.mjs --base-url http://localhost:9464

# Output is written to docs/auth-latency-baseline.json (gitignored).
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
- **Constraint:** the metrics endpoint then sat on the API port behind an
  authentication gate, and the scrape job of the Kind cluster could not pass it.
  The histogram had no scrapeable samples.
- **p50:** not captured
- **p95:** not captured
- **p99:** not captured

  The dashboard now serves metrics on a metrics-only port that the network
  policy opens to the cluster scraper only (charts#515). The baseline can be
  captured from that port.

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
