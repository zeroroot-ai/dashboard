# Contributing to `dashboard`

This is the Gibson console: Next.js, Server-Action auth, and ConnectRPC to the daemon over Envoy with SPIFFE mTLS.

If anything here is unclear, open an issue rather than guessing — an unclear
contributing guide is a bug in this file.

## Prerequisites

- Node 22+ and `pnpm`
- Access to the proto registry for `pnpm proto:generate`

## Build and test

```sh
pnpm dev            # :3000
pnpm build          # runs the prebuild policy-guard chain
pnpm test && pnpm typecheck && pnpm lint
```

## The merge gate

`pnpm build` runs a prebuild guard chain, and the most important rule it
enforces is architectural: **the dashboard never opens a direct daemon gRPC
channel.** All traffic goes through Envoy and ext-authz. A direct channel would
bypass authorization entirely, so the guard fails the build rather than warning.

Fix the code, never disable the guard.

Every pull request runs it. A red gate is a real signal: **do not** disable a
guard to get a PR through. If a guard is wrong, fix the guard in the same PR
and say why — a guard that needs re-pinning after an unrelated edit is a defect
in the guard.

## Pull requests

- **Conventional Commits in the PR title** — `feat:`, `fix:`, `chore:`,
  `docs:`, `ci:`, `test:`, `refactor:`. The subject must start lowercase;
  `pr-title-lint` enforces both.
- **One root cause per PR.** Two unrelated fixes are two pull requests.
- **Rebase, never merge.** `git fetch origin && git rebase origin/main`
- Releases are automatic via release-please. Never hand-tag, never hand-edit a
  version.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## License

**Elastic License 2.0** — see [LICENSE](LICENSE). Read it, download it, run it, modify it; do not offer it to third parties as a hosted or managed service. GitHub shows this repo as "NOASSERTION" because ELv2 is not OSI-approved. The surface you build against — [`sdk`](https://github.com/zeroroot-ai/sdk) and [`adk`](https://github.com/zeroroot-ai/adk) — is Apache-2.0.
