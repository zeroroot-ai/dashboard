# Auth-resolution-hardening, Post-deploy Soak Guide

Spec: `auth-resolution-hardening`. Audience: on-call SRE.

This document describes what to watch in production after the
`auth-resolution-hardening` spec lands: the metric names, the alerts that fire
from the Prometheus rules committed under this spec, the Grafana dashboard URL,
and the rollback procedure.

---

## Metrics to monitor during soak

All metrics are exported by the dashboard pod at `/api/metrics` and scraped by
the in-cluster Prometheus.

| Metric | Type | What it measures | Steady-state expectation |
|---|---|---|---|
| `dashboard_signin_total{outcome="success"}` | Counter | Successful OIDC sign-in completions (JWT cookie written) | Grows with user activity; no sign-in failures at 0% error rate |
| `dashboard_signin_total{outcome="error", error_reason="..."}` | Counter | Failed sign-in attempts by machine-readable reason | Should be 0 or very low; any sustained rate triggers `DashboardSignInErrorRateHigh` |
| `dashboard_signin_duration_seconds` | Histogram | OIDC callback latency from code-exchange start to cookie write | p95 < 1.5 s; p99 < 3.0 s (SLO per spec R8) |
| `dashboard_login_error_total{reason="..."}` | Counter | `/login/error` page renders by reason code | Mirrors `signin_total{outcome="error"}`; non-zero means users are seeing the error UX |
| `dashboard_membership_resolution_total{outcome="..."}` | Counter | FGA membership resolution outcomes (single/multi/zero/fga_error/daemon_error) | `fga_error` and `daemon_error` should be 0; sustained non-zero triggers `DashboardFGAUnreachable` |
| `dashboard_membership_resolution_duration_seconds` | Histogram | ListMyMemberships RPC latency from dashboard | p99 < 500 ms under normal FGA load |
| `dashboard_active_tenant_validation_total{outcome="..."}` | Counter | Cookie validation outcomes per protected request | `stale` and `forbidden` should be low; spikes indicate revocation events or cookie tampering |
| `dashboard_user_token_forwarding_disabled_total` | Counter | Dashboard RPCs served via the SPIFFE-fallback transport | **Should be 0 in steady state.** Non-zero means `USE_USER_TOKEN_FORWARDING=false` is active, the SPIFFE-fallback transport is engaged and per-user FGA audit attribution is disabled. Non-zero during soak requires investigation before declaring the spec complete. |

---

## Alert rules

Rules are committed under `enterprise/deploy/helm/gibson/files/prometheus/rules/`.

### `DashboardSignInErrorRateHigh`

- **File:** `auth-alerts.yaml`
- **Condition:** Sign-in error rate (errors / total) > 1% sustained over 5 minutes.
- **Severity:** `page`
- **Fires when:** Any combination of `fga_unavailable`, `jwks_unavailable`,
  `oidc_token_exchange_failed`, `daemon_unavailable`, or `unknown` reasons
  totals more than 1% of sign-in volume.
- **During soak:** Should not fire unless the underlying FGA or Zitadel is
  degraded. If it fires within the first 30 minutes post-deploy, check whether
  the spec's Auth.js callback changes introduced a regression.

### `DashboardFGAUnreachable`

- **File:** `auth-alerts.yaml`
- **Condition:** `dashboard_membership_resolution_total{outcome="fga_error"}` > 0
  sustained for 30 seconds.
- **Severity:** `page`
- **Fires when:** The dashboard cannot reach the daemon's ListMyMemberships
  endpoint. This can indicate FGA pod crash, network policy change, or daemon
  restarts.
- **During soak:** If this fires immediately after deploy, check that the daemon
  pod is healthy and the NetworkPolicy permits dashboard→Envoy→daemon traffic.

### `DashboardSignInLatencyBudgetBurn`

- **File:** `auth-alerts.yaml`
- **Condition:** Multi-window error-budget burn rate for the
  `p95(dashboard_signin_duration_seconds) < 1.5s` SLO.
- **Severity:** `page`
- **Fires when:** The SLO error budget is being consumed faster than 2x the
  sustainable rate (short + long burn windows both exceeded).
- **During soak:** This alert fires when FGA roundtrips or Zitadel JWKS fetches
  slow down the OIDC callback. If latency is elevated, check:
  1. `dashboard_membership_resolution_duration_seconds`, FGA slow?
  2. Zitadel JWKS endpoint latency (visible in Envoy access logs).
  3. Prometheus recording rules `slo:dashboard_signin_p95_seconds` -
     confirm they are evaluating correctly.

---

## Grafana dashboard

- **URL:** `https://grafana.gibson.svc/d/auth-resolution-hardening/auth-resolution-hardening`
  (accessible via `kubectl port-forward svc/grafana 3000:80 -n monitoring` on
  the dev cluster).
- **File committed at:** `enterprise/deploy/helm/gibson/files/grafana/dashboards/auth.json`.
- **Discovery:** The Grafana sidecar mounts the dashboard JSON automatically via
  ConfigMap annotation; no manual import required after `helm upgrade`.
- **Default time range:** Last 6 hours.
- **Panels:**
  - Sign-in rate: success vs. error (stacked time series).
  - Sign-in latency: p50/p95/p99 (time series with SLO annotations).
  - Membership resolution outcomes (pie + time series).
  - Active-tenant validation outcomes.
  - Login error breakdown by reason (bar chart).

---

## Rollback procedure

This spec adds observability (metrics, alerts, Grafana) and deterministic error
UX. It does not change the core authentication code path. However, if the
`/login/error` redirect behaviour is causing user friction or a regression:

1. **Identify the regression.** Check `dashboard_login_error_total` by reason.
   If `fga_unavailable` is elevated, the issue is FGA, not the error-UX code.
   If `oidc_token_exchange_failed` is elevated, the issue is Zitadel or
   Auth.js config.

2. **No code path rollback needed for error-UX only issues.** The `/login/error`
   page is additive, it replaces the previous silent `federated-signout` loop.
   Rolling back to the silent signout is strictly worse. Instead, fix the
   underlying error source.

3. **To roll back the Prometheus rules or Grafana dashboard** (e.g., if a
   recording rule causes query load issues):
   - Edit `enterprise/deploy/helm/gibson/files/prometheus/rules/auth-alerts.yaml`
     or `auth-slos.yaml` via a Helm values PR to `enterprise/deploy/`.
   - The Prometheus operator will reconcile within 60 seconds.
   - Do NOT directly `kubectl edit` the PrometheusRule, use Helm/GitOps.

4. **If `USE_USER_TOKEN_FORWARDING=false` was set as a soak backout** (from the
   `dashboard-fga-user-identity` spec):
   - `dashboard_user_token_forwarding_disabled_total` will be non-zero.
   - This is expected during a controlled backout window but must return to 0
     before the soak is declared complete.
   - To re-enable forwarding: set `USE_USER_TOKEN_FORWARDING=true` in the
     dashboard Helm values and redeploy.

---

## Soak completion criteria

The auth-resolution-hardening spec soak is complete when ALL of the following
hold for a 24-hour window post-deploy:

- [ ] `DashboardSignInErrorRateHigh` has not fired.
- [ ] `DashboardFGAUnreachable` has not fired.
- [ ] `DashboardSignInLatencyBudgetBurn` has not fired.
- [ ] `dashboard_user_token_forwarding_disabled_total` is 0.
- [ ] p95 sign-in latency (from `dashboard_signin_duration_seconds`) is below 1.5 s.
- [ ] `dashboard_login_error_total` shows no unexpected spikes.
- [ ] The Grafana dashboard renders all panels with data (no "no data" on sign-in panels).

---

## Baseline latency reference

Run `node scripts/auth-latency-baseline.mjs --base-url <url>` against the
target environment after sign-ins have flowed through the server to capture
p50/p95/p99. The output is written to `enterprise/docs/auth-latency-baseline.json`.

The baseline measurement for this spec was captured before the full FGA
roundtrip landed. After `dashboard-fga-user-identity` ships the baseline should
be re-run and compared: the FGA roundtrip adds an expected ~50–150 ms to the
membership-resolution phase. As long as p95 stays below 1.5 s the SLO is met.
