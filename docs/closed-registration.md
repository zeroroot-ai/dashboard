# closed-registration.md, `zeroroot-ai/dashboard`

Admin-gated closed registration for self-hosted installs. AI-agent-facing.
Module 6 of PRD dashboard#920. Prerequisite: dashboard#921 (deployment-profile
resolver), dashboard#922 (front-door conditional).

## Overview

A self-hosted operator can lock down registration so that only invited (or
admin-provisioned) users can join the instance. This matches GitLab
self-managed's behaviour: the default is open (anyone can create an account),
and an admin can close it so that the front door is sign-in only.

On Gibson self-hosted, "closed registration" means:

- The front door (`/login`) shows **Sign in** only — no "Create account" CTA.
- Direct hits to `/signup` are refused — they redirect to `/login`.
- No new principals can self-provision. Tenants must be created by a
  platform operator via `AdminTenantService.AdminProvisionTenant`.

This posture is controlled by a single Helm value, described below.

## How to close registration

Set `gibson.signupSelfServe` to `false` in your Helm overlay:

```yaml
# values-selfhosted.yaml (or your environment overlay)
gibson:
  signupSelfServe: false   # default: true (open registration)
```

The chart translates this to `SIGNUP_SELF_SERVE=""` (unset / falsy) in the
dashboard pod environment. The deployment-profile resolver (`src/lib/deployment-profile.ts`,
dashboard#921) reads that knob once at server startup and sets
`selfServeSignup: false` in the resolved `DeploymentProfile`. Every surface
that needs to know the posture reads the resolved profile — never the raw
env — which ensures the front door, the signup route, and any future surfaces
stay in sync automatically.

**Kind / local dev:** the default `values-kind.yaml` shipped in the Helm
chart leaves `SIGNUP_SELF_SERVE=true` (self-hosted open-registration profile).
To exercise closed registration locally, override the value in your kind
`values-local.yaml`:

```yaml
gibson:
  signupSelfServe: false
```

## What the closed-registration posture does (end to end)

| Surface | selfServeSignup=true (open) | selfServeSignup=false (closed) |
|---|---|---|
| `/login` front door | Shows "Sign in" + "Create account" | Shows "Sign in" only |
| `/signup` route | Renders the registration form | Redirects to `/login` |
| Registration provisioning | User self-provisions via `SignupService.Signup` | No self-provisioning path |
| Tenant creation | On successful signup | Admin-only via `AdminProvisionTenant` |

The front-door conditional is implemented in `app/(public)/login/login-form.tsx`
(the `selfServeSignup` prop, dashboard#922). The route-level guard is
implemented in `app/(public)/signup/page.tsx`:

```ts
// app/(public)/signup/page.tsx
const profile = getDeploymentProfile();
if (!profile.selfServeSignup) {
  redirect("/login");
}
```

Tests for both: `app/(public)/login/__tests__/login-form.test.tsx` (front door)
and `app/(public)/signup/__tests__/signup-page-closed-registration.test.tsx`
(route gate, dashboard#925).

## Default posture

The OSS default (self-hosted, no overlay) is **open registration**
(`SIGNUP_SELF_SERVE=true`). A fresh `helm install` gives you a working
sign-up path immediately. This is intentional: the OSS default is a complete,
self-contained product. An operator who wants to lock down registration sets
`gibson.signupSelfServe: false` explicitly as a deliberate administrative
decision.

This default is enforced by the deploy render guard (`deploy#1060`,
`helm/gibson/tests/signup-seam.bats`), which asserts that the OSS-profile
Helm render has `SIGNUP_SELF_SERVE` set (open registration is the open-source
default).

## Creating the first/owner account when registration is closed

**When registration is open (the default):** the operator simply self-serves
signs up — no bootstrap needed. The first user to complete the signup flow
for a tenant becomes the `tenant_admin` for that tenant (by the daemon's
provisioning logic in `SignupService.Signup`).

**When registration is closed on a fresh install:** use the
`bootstrap-tenant-owner` one-shot (gibson#1103). It creates the owner's Zitadel
login and the FGA ownership tuple — the two things `AdminProvisionTenant` does
not — without ever reopening registration and without requiring a pre-existing
human session. The actor invoking it *is* the platform operator (same shape as
`active-session-backfill` / `tenant-owner-backfill`), so there is no
chicken-and-egg.

`AdminTenantService.AdminProvisionTenant` (gibson daemon-local,
`internal/server/daemon/api/gibson/tenant/v1/admin_tenant.proto`) still only
enqueues the tenant-creation op — the tenant-operator drains it, creates the
`Tenant` CR, and the provisioning saga stands up the namespace, entitlements,
and the tenant's per-tenant Zitadel org (`EnsureZitadelOrg`). That RPC mints no
human user and writes no ownership tuple; `bootstrap-tenant-owner` closes that
gap.

### Runbook

**Prerequisite:** the tenant must already be provisioned far enough that its
per-tenant Zitadel org exists — i.e. `AdminProvisionTenant` has run and the Tenant
CR's `status.zitadelOrgID` is populated. If it is not yet, the command exits
non-zero with `tenant %q has no status.zitadelOrgID yet — wait for tenant
provisioning (EnsureZitadelOrg) to converge and retry`; wait for the saga to
converge and re-run.

The binary ships in the daemon image at
`/usr/local/bin/bootstrap-tenant-owner`. Run it as an in-cluster one-shot (a
`Job`, or `kubectl exec` into a daemon pod) with the operator's environment —
it reads an in-cluster kubeconfig and the same Zitadel-admin and FGA config the
daemon uses:

```bash
bootstrap-tenant-owner -tenant <tenant-id> -owner-email owner@example.com
```

| Flag | Meaning |
|---|---|
| `-tenant` | the Tenant CR name / tenant id (required) |
| `-owner-email` | the owner's email address (required) |

Required environment (already present on the daemon workload):
`GIBSON_IDP_ADMIN_ISSUER`, `GIBSON_IDP_ADMIN_CLIENT_ID`,
`GIBSON_IDP_ADMIN_CLIENT_SECRET`, `GIBSON_IDP_ADMIN_DISCOVERY_URL`,
`GIBSON_IDP_ZITADEL_ORG_ID` (platform admin org), `GIBSON_PUBLIC_URL`,
`EXT_AUTHZ_FGA_ADDR`, `EXT_AUTHZ_FGA_STORE_ID`, `EXT_AUTHZ_FGA_MODEL_ID`.

What it does, in order:

1. Resolves the tenant's per-tenant Zitadel org id from the Tenant CR's
   `status.zitadelOrgID`.
2. `EnsureHumanUser` — find-or-create the owner's Zitadel human user in that org
   (the same call `MembershipService.AcceptInvitation` makes for an invited
   member). **Zitadel emails the owner a credential-setup / verification code; no
   password ever crosses this binary.**
3. `AddTenantMember` with role `owner` (idempotent — a 409 is treated as success).
4. Writes the FGA tuple `(user:<owner-id>, owner, tenant:<tenant-id>)` if absent
   — the top of the tenant relation hierarchy (`admin`/`writer`/`member` all
   derive `or owner` in `model.fga`; this is what the dashboard and operators
   call `tenant_admin` authority).

**Idempotent and safe to retry.** A re-run for an owner who already holds the
tuple reports `outcome=already_owner` and exits zero; Zitadel steps are
find-or-create. Order is Zitadel first, FGA second, so a partial failure leaves
no ownership tuple pointing at a nonexistent user.

The owner then completes credential setup from the Zitadel email and signs in at
`/login` — registration stays closed throughout.

## Cross-links

- Deployment-profile resolver: `src/lib/deployment-profile.ts` (dashboard#921)
- Front-door conditional: `app/(public)/login/login-form.tsx` (dashboard#922)
- Signup route gate: `app/(public)/signup/page.tsx`
- Route-gate test: `app/(public)/signup/__tests__/signup-page-closed-registration.test.tsx`
- Front-door test: `app/(public)/login/__tests__/login-form.test.tsx`
- PRD: dashboard#920 (Module 6)
- Issue: dashboard#925
