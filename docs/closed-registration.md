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

**When registration is closed on a fresh install:** there is currently no
turnkey first-principal bootstrap. `AdminTenantService.AdminProvisionTenant`
(gibson daemon-local, `internal/server/daemon/api/gibson/tenant/v1/admin_tenant.proto`)
enqueues a tenant-creation op — the tenant-operator drains it and creates the
`Tenant` CR — but this RPC does NOT create the owner's Zitadel login (the human
identity) or provision the FGA membership tuple for the owner. After calling
`AdminProvisionTenant`, the tenant exists in the operator's queue but there is
no Zitadel user for the owner and no way to sign in as that owner.

This is a **known gap**, tracked as a follow-up in the gibson repo. Until it
is addressed, the recommended workaround for a closed-registration self-hosted
install is:

1. Start with registration **open** (`gibson.signupSelfServe: true`, the default).
2. Create the first/owner account via the normal signup flow.
3. Confirm that account has `tenant_admin` in the dashboard.
4. Then close registration by setting `gibson.signupSelfServe: false` and
   redeploying (or restarting the dashboard pod to pick up the new env).

This workaround is safe and sufficient for the "locked-down after initial
setup" use case. The follow-up issue will address the case where an operator
wants a fully closed install from the very first boot.

See the filed follow-up: gibson#1103 — first-admin bootstrap for
closed-registration self-hosted installs.

## Cross-links

- Deployment-profile resolver: `src/lib/deployment-profile.ts` (dashboard#921)
- Front-door conditional: `app/(public)/login/login-form.tsx` (dashboard#922)
- Signup route gate: `app/(public)/signup/page.tsx`
- Route-gate test: `app/(public)/signup/__tests__/signup-page-closed-registration.test.tsx`
- Front-door test: `app/(public)/login/__tests__/login-form.test.tsx`
- PRD: dashboard#920 (Module 6)
- Issue: dashboard#925
