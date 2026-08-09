# Gibson Dashboard

The web UI for the Gibson platform. Operators use it to manage tenants,
launch missions, browse findings, run admin RPCs, and watch the live
event graph. Identities live in Zitadel; authorisation is enforced by
the daemon's ext-authz layer; the dashboard never opens a direct gRPC
channel to the daemon.

## Stack

- **Next.js 16 / React 19**, App Router, TypeScript everywhere.
- **pnpm** for package management.
- **Auth.js v5** with Zitadel as the upstream IdP.
- **ConnectRPC** over **SPIFFE mTLS**, fronted by Envoy + ext-authz.
- **Vitest** for unit tests, **Playwright** for end-to-end tests.

## Prerequisites

- Node.js 20.x or newer.
- pnpm 10.x (`corepack enable && corepack prepare pnpm@10 --activate`).
- A local kind cluster from `enterprise/deploy/helm/gibson/` for any
  workflow that talks to the daemon (most of them).
- Sibling checkouts of `core/gibson/` and `core/sdk/` if you intend to
  regenerate proto bindings (`pnpm proto:generate`).

## Clone

```bash
git clone https://github.com/zeroroot-ai/dashboard.git
cd dashboard
pnpm install
```

## Common commands

```bash
pnpm dev            # dev server on :3000
pnpm build          # full production build (runs prebuild policy guards)
pnpm test           # vitest unit tests
pnpm test:e2e       # playwright suite
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm proto:generate # regenerate src/gen/ TS proto bindings (workstation-only)
```

`pnpm prebuild` runs a chain of policy-guard scripts (no direct daemon
gRPC, no legacy auth artefacts, RBAC minimality, authz-registry
freshness, etc.). Do not disable them, fix the underlying code.

## Standalone build (outside the polyrepo workspace)

`pnpm build` runs the prebuild chain, which includes four freshness gates
(`check-plans-fresh.mjs`, `check-stripe-tiers-fresh.mjs`,
`check-authz-registry-fresh.mjs`, `check-mission-schema-fresh.mjs`) whose
generators read sibling private repos in the canonical `~/Code/zeroroot.ai/`
workspace. Those siblings are not present in a standalone checkout.

The generators themselves are **not** part of `prebuild`; regeneration is
explicit (`pnpm gen:plans`, `pnpm gen:stripe-tiers`, `pnpm gen:authz`,
`pnpm gen:mission-schema`) and requires the workspace. The committed generated
files (`src/generated/plans.ts`, `src/lib/billing/stripe_gen.ts`,
`src/gen/authz/registry.ts`, `src/data/mission-definition.schema.json`) are the
source of truth at build time.

No skip envs are needed, and none exist for these four gates. Each gate asks
its generator `--probe` whether the upstream source is on disk. When it is not,
the gate runs its STRUCTURAL pass instead: the committed artifact must exist,
be non-empty, parse, and carry its generator's header, so a deleted or emptied
artifact still fails the build. When the workspace is present, the gate
byte-diffs the committed artifact against freshly generated output.

The one skip that remains is unrelated to freshness:

```bash
SKIP_DASHBOARD_RBAC_CHECK=1 pnpm build
```

`check-dashboard-rbac-minimal.mjs` shells out to `helm template`, and a
standalone checkout has no Helm binary. The `Dockerfile` builder stage sets
this same env and nothing else; keep the two in sync.

## Architecture

This repo is one piece of the wider Gibson platform polyrepo. For the
authoritative platform-wide overview see
`enterprise/docs/ARCHITECTURE.md` in the workspace. For dashboard-only
conventions see [`CLAUDE.md`](./CLAUDE.md), which covers:

- The Auth.js / Zitadel surface and the post-Better-Auth migration.
- The `useAuthorize` / `assertAuthorized` two-layer authz pattern.
- Proto regeneration into `src/gen/`.
- The canonical structured logger at `src/lib/logger.ts`.
- The Envoy + ext-authz daemon path and the `check-no-direct-daemon-grpc`
  guard.

## Repository

`https://github.com/zeroroot-ai/dashboard`

## License

This project is licensed under the Elastic License 2.0. See the
[`LICENSE`](./LICENSE) file for the full text.
