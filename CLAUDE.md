# Dashboard CLAUDE.md

This is the Gibson dashboard (Next.js 16 / React 19 / App Router). The
upstream `README.md` is the Shadcn UI Kit template's README and is left
intact as the source — do not edit it. This file captures the
Gibson-specific architecture decisions a contributor (or LLM agent)
needs to know before changing auth, signup, or session handling.

## Authentication surface

There is **no public Better Auth HTTP surface**. After the
`dashboard-auth-server-actions` spec, browsers authenticate exclusively
through React Server Actions in `app/actions/auth/`. The Better Auth
catch-all route (`app/api/auth/[...all]/route.ts`) is deleted; a build
guard in `scripts/check-no-public-auth.mjs` fails the build if anyone
re-introduces it.

Server Actions:

| Action                                  | Replaces                                |
| --------------------------------------- | --------------------------------------- |
| `signUpAction` (`signup.ts`)            | `POST /api/auth/sign-up/email` + `/api/signup` |
| `signInAction` (`signin.ts`)            | `POST /api/auth/sign-in/email`          |
| `signOutAction(redirectTo?)`            | `POST /api/auth/sign-out`               |
| `getSession` (`session.ts`, server only)| `GET /api/auth/get-session`             |
| `getSessionClient` (`session-client.ts`)| client wrapper for the above            |
| `createOrgAction` etc. (`org.ts`)       | `POST /api/auth/organization/*`         |

Client components that need the current session use
`useSession()` from `src/lib/session-client.ts`. It calls the
`getSessionClient` Server Action under the hood — Server Action RPC has
its own Origin + CSRF protections from Next.js.

## SPIFFE-authenticated admin surface (preserved)

The tenant-operator pod talks to the dashboard's
`/api/admin/provisioning/*` routes using a SPIFFE JWT-SVID Bearer token
that is verified against the SPIRE trust bundle exposed by the
`spiffe-jwks-exporter` sidecar. This is a workload-to-workload trust
boundary, separate from the browser path. **Do not** consolidate it
with the Server Actions above.

## Better Auth instance

`src/lib/auth-server.ts` is the single Better Auth construction site.
Plugins:
- `organization` (with teams)
- `admin`
- `nextCookies()` — must remain the **last** plugin so its hooks see
  set-cookie commands from earlier plugins and forward them through
  Next.js `cookies()`. Without it, Server Actions cannot commit Better
  Auth session cookies.

A `hooks.before` middleware enforces password complexity server-side as
a defence-in-depth check; the same rules live in
`src/lib/validators/auth.ts` and are used by both the form and
`signUpAction`.

## Debug mode

Set `dashboard.debug: true` in the helm values to:
- include full error stacks on API responses
- raise Better Auth's logger to `debug`
- enable `/api/debug/recent-errors` (in-memory ring buffer of recent
  server-side errors — used by the in-page `<DebugErrorPanel/>` and by
  operators / agents diagnosing a stuck pod)

Default is OFF. Never enable in any environment that sees real users.
