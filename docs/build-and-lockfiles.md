# Build, toolchain, and lockfiles

Phase-0 reproducible-build hardening for the dashboard (open-core relayout).
It carries the dashboard half of two org quality bars,
reproducible builds and dead-code gates. The document that stated those bars
lived in the private docs repository, which the org deleted on 2026-09-04, so
this file is the surviving statement of both for this repository.

## Toolchain pin

- **Node is pinned to `nodejs 24.x` in `.tool-versions`** (currently `24.20.0`,
  the exact patch shipped by the mirror base image). This is the single source
  of truth for the dev toolchain. `mise`/`asdf` read it; CI and the image build
  use the same major.
- The pin matches the **digest-pinned base image** in the `Dockerfile`
  (`ghcr.io/zeroroot-ai/mirror/node@sha256:…`, the `node:24-alpine` mirror).
  Dev == CI == image Node major, by construction. Before this pass
  `.tool-versions` said `nodejs 22` while the image built on `node:20` — the
  same class of drift the quality-bars doc calls out for gibson
  (`go 1.26.4` vs `golang:1.25`).

## Base image — digest-pinned, mirror-sourced

Every `FROM` in the `Dockerfile` pins the **multi-arch manifest-list (OCI
index) digest** of `ghcr.io/zeroroot-ai/mirror/node:24-alpine`, not the
floating tag. Tag pins are not reproducible (the doc's rule); the index digest
is required (not a per-arch manifest digest) because the image is built
multi-arch via buildx. To re-pin after a mirror refresh:

```bash
docker buildx imagetools inspect ghcr.io/zeroroot-ai/mirror/node:24-alpine
# copy the top-level (index) Digest into every FROM
```

## One lockfile

`pnpm-lock.yaml` is the one lockfile (dashboard#246). Local dev
(`pnpm install`, `make bootstrap`), CI and the container image all install
from it. The `Dockerfile` enables corepack, which installs the pnpm release
that `packageManager` in `package.json` names, and runs
`pnpm install --frozen-lockfile`.

The repo used to carry a second lockfile, `package-lock.json`, for an
`npm ci` image build. Dependabot updated only `pnpm-lock.yaml`, so each of its
npm pull requests failed `npm ci` in the merge group. The two files had also
drifted apart, so the dev build and the image ran different patch versions.
The npm path is deleted, with its sync check (`check-lockfile-sync.mjs`) and
the npm-only `overrides` copy in `package.json`.

### Patched dependencies

`patchedDependencies` applies `patches/next-auth.patch` (adds explicit `.js`
extensions to `next/*` imports). pnpm applies it at install time, so the
image build now gets the same patched `next-auth` as dev.

After a dependency change, run `pnpm install` and commit `pnpm-lock.yaml`.

## Dead-code gate — knip (blocking)

`knip` runs at the end of the `prebuild` chain and is **blocking**
(non-zero exit fails the build). Config: `knip.jsonc`.

Scope of the blocking gate (the categories enforced as `error`):

- **`files`** — a TS/TSX file in `project` scope reached by no entry point.
- **`dependencies`** / **`devDependencies`** — a declared package imported nowhere.
- **`unlisted`** — a dependency imported but not declared in `package.json`.
- **`unresolved`** — an import that resolves to nothing.
- **`binaries`** — a script invoking a binary not provided by any dependency.

`files` / `dependencies` / `devDependencies` were flipped to `error` in the
dead-code purge. That pass deleted **147 dead files**
(abandoned Gibson features under `src/**`, `components/gibson/**`,
`app/**` — onboarding wizard, glossary, mission-form, help panel, websocket
stores, the unused-but-tested `AgentInstallDialog`, etc. — **plus** the
genuinely-unused Shadcn template files: the `components/ui/*` components that
were never imported by the product, e.g. `accordion`, `carousel`, `chart`,
`drawer`, `calendar`, `menubar`, …) and removed **78 dead dependencies** (the
`@radix-ui/*` / `@tiptap/*` / `@fullcalendar/*` blocks that those dead template
files were the sole importers of, plus `recharts`, `motion`, `vaul`, etc.).
The **kept** template surface (the `components/ui/*` files the product *does*
import) is untouched, per `CLAUDE.md`. The `files` ignore set is now empty.

The **`exports` (≈260) / `types` (≈491)** categories remain `off` — they are
entangled (unused exports from *kept* template `components/ui/**`, redundant
dual default+named exports in live files, and co-located internal
`*Result`/`*Input` interfaces), not clean dead code. Purging them is a
deliberate, reviewed per-symbol pass, a scoped follow-up. When done, flip `exports` / `types` to `error`.

Precise, justified `ignoreDependencies` (not blanket):

- `pg` — used only by the e2e database helper `e2e/auth/helpers/db.ts`, which
  loads it with `require`; `pg` is intentionally not a declared dependency.
- `@vitest/coverage-v8` — used only by the optional `test:coverage` script.
- `@auth/core` — the `@auth/core/jwt` subpath is re-exported via `next-auth`
  (a transitive); declaring it directly would duplicate next-auth's pin.
- `tailwindcss` / `tailwindcss-animate` — consumed by CSS, not TS: `@import
  "tailwindcss"` and `@plugin "tailwindcss-animate"` in `app/globals.css`
  (knip only follows TS/TSX imports).
- `eslint-config-next` — provides the `next/core-web-vitals` + `next/typescript`
  configs that `.eslintrc.js` extends (a string ref knip can't follow).
- `pino-pretty` — referenced by string as the pino transport `target` in
  `src/lib/logger.ts` + listed in `next.config.ts` `serverExternalPackages`.
- `@bufbuild/buf` / `@bufbuild/protoc-gen-es` — the proto-generation toolchain
  invoked by `scripts/proto-generate.mjs` / `gen-authz-registry.mjs` (`buf`
  binary + the ES codegen plugin), not a TS import.

## Uniform Makefile contract

`make bootstrap | build | test | check | image` (plus `lint`, `typecheck`,
`knip`, `proto`) — the same target names every repo implements. `make check`
mirrors the enforced gates: `typecheck && knip && ast-checks` (the same chain
CI enforces via the `prebuild` chain + `next build`'s typecheck). `lint` is a
separate target, not part of `check`: ESLint is not a CI gate today and the
repo carries pre-existing lint debt (2 errors / ~198 warnings on `main`), so
folding it into `check` would make the contract target red out of the box.
Cleaning up the lint debt and promoting `lint` into `check` is a follow-up. See
the `Makefile` for the full target list (`make help`).

## Follow-up (scoped)

Tracked separately (filed against dashboard):

1. **Unused exports/types purge** — the dead-file and
   dead-dependency purge landed and `files` / `dependencies` / `devDependencies`
   are now `error`. The remaining `exports` (≈260) / `types` (≈491) categories
   stay `off` because they are entangled (kept-template `components/ui/**`
   exports, dual default+named export redundancy, co-located internal types);
   purge them per-symbol, then flip `exports` / `types` to `error`.
