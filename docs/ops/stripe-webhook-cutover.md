# Stripe Webhook Cutover Runbook

This document describes the three-phase migration from the legacy webhook path
(`app.zeroroot.ai/api/billing/webhook`) to the dedicated webhook subdomain
(`webhooks.zeroroot.ai/stripe`).

**Status:** Phase 0 (parallel listen) — both endpoints are active.

---

## Why migrate?

The new `webhooks.zeroroot.ai` Ingress provides:
- Stricter WAFv2 WebACL scoped to Stripe IP ranges only.
- TLS 1.3-only policy on the webhook subdomain.
- Independent rate limiting and traffic isolation from the main dashboard.
- A cleaner URL surface for Stripe signature verification.

---

## Phase 0: Parallel listen (current)

**Goal:** Configure Stripe to deliver to both the old and new endpoints
simultaneously. No user-facing impact. Validate the new endpoint works
correctly before decommissioning the old one.

**Stripe Dashboard actions:**
1. Navigate to **Developers** → **Webhooks** → **Add endpoint**.
2. URL: `https://webhooks.zeroroot.ai/stripe`
3. Events: select all events (or mirror the current endpoint's selection).
4. Note the new webhook signing secret — add it as a second env var
   (`STRIPE_WEBHOOK_SECRET_NEW`) and update the dashboard to accept both
   until Phase 1 is complete. Alternatively, reuse the same secret if the
   Stripe account supports it.
5. Leave the existing `app.zeroroot.ai/api/billing/webhook` endpoint active.

**Validation (must pass before Phase 1):**
- Trigger a test event via Stripe CLI: `stripe trigger customer.subscription.created`
- Verify both endpoints receive the event and log `[billing/webhook] ok`.
- Monitor `gibson_stripe_event_total{outcome="success"}` in Grafana for 24 hours.
- No errors in Loki for `app=gibson-dashboard component=billing/webhook`.

---

## Phase 1: Cutover

**Goal:** Remove the old endpoint from Stripe Dashboard. All traffic now
flows exclusively through `webhooks.zeroroot.ai/stripe`.

**Prerequisites:**
- Phase 0 parallel-listen has been running for at least 7 days with zero errors
  on the new endpoint.
- `gibson_stripe_event_total` shows consistent event delivery on the new endpoint.

**Stripe Dashboard actions:**
1. Navigate to **Developers** → **Webhooks**.
2. Select the `app.zeroroot.ai/api/billing/webhook` endpoint.
3. Click **Delete endpoint**. Confirm deletion.
4. Update `STRIPE_WEBHOOK_SECRET` env var to the new endpoint's signing secret
   (if they differ). Rolling restart the dashboard pod to pick up the new secret.

**Validation:**
- Trigger another test event and verify it arrives at `webhooks.zeroroot.ai/stripe` only.
- Confirm the old endpoint receives no events for 24 hours (check Loki).

---

## Phase 2: Tombstone

**Goal:** Fully retire the old webhook path. Replace the POST handler with a
410 Gone response. Update the Ingress tombstone manifest in gitops.

**Prerequisites:**
- Phase 1 has been active for at least 30 days.
- Zero events received at `app.zeroroot.ai/api/billing/webhook` for 72 hours.

**Dashboard code change:**
1. In `app/api/billing/webhook/route.ts`, replace the POST handler body with:
   ```typescript
   return NextResponse.json({ gone: true }, { status: 410 });
   ```
   (The GET handler already returns 410 — this completes the tombstone.)
2. Commit and deploy.

**GitOps Ingress change:**
1. Apply the tombstone Ingress in `enterprise/gitops/apps/gibson/webhook-ingress.yaml`
   (the second YAML document, currently commented as "apply only after migration window closes").
2. Open a PR; ArgoCD will sync the tombstone Ingress to the cluster.

**Validation:**
- `GET https://app.zeroroot.ai/api/billing/webhook` returns 410 with `{"gone":true}`.
- `POST https://app.zeroroot.ai/api/billing/webhook` returns 410 with `{"gone":true}`.
- `POST https://webhooks.zeroroot.ai/stripe` continues to work normally.

---

## Rollback plan

If either Phase 1 or Phase 2 causes issues:
1. Re-add the old endpoint in Stripe Dashboard (Phase 1 rollback).
2. Revert the code change and redeploy (Phase 2 rollback).
3. The parallel-listen period provides a safety window — Stripe retries for up
   to 72 hours, so a same-day rollback will not lose events.

---

## Contact

For questions about this migration, contact the platform team
(`platform@zeroroot.ai`) or open an issue in `zeroroot-ai/dashboard`.
