# Build, toolchain, and lockfiles

Phase-0 reproducible-build hardening for the dashboard (open-core relayout,
dashboard#805). Companion to the org-wide
[`RESTRUCTURE-QUALITY-BARS.md`](../../../../docs/architecture/open-core/RESTRUCTURE-QUALITY-BARS.md)
§1 (reproducible builds) and §3 (dead-code gates).

## Toolchain pin

- **Node is pinned to `nodejs 20.x` in `.tool-versions`** (currently `20.20.2`,
  the exact patch shipped by the mirror base image). This is the single source
  of truth for the dev toolchain. `mise`/`asdf` read it; CI and the image build
  use the same major.
- The pin matches the **digest-pinned base image** in the `Dockerfile`
  (`ghcr.io/zeroroot-ai/mirror/node@sha256:…`, the `node:20-alpine` mirror).
  Dev == CI == image Node major, by construction. Before this pass
  `.tool-versions` said `nodejs 22` while the image built on `node:20` — the
  same class of drift the quality-bars doc calls out for gibson
  (`go 1.26.4` vs `golang:1.25`).

## Base image — digest-pinned, mirror-sourced

Every `FROM` in the `Dockerfile` pins the **multi-arch manifest-list (OCI
index) digest** of `ghcr.io/zeroroot-ai/mirror/node:20-alpine`, not the
floating tag. Tag pins are not reproducible (the doc's rule); the index digest
is required (not a per-arch manifest digest) because the image is built
multi-arch via buildx. To re-pin after a mirror refresh:

```bash
docker buildx imagetools inspect ghcr.io/zeroroot-ai/mirror/node:20-alpine
# copy the top-level (index) Digest into every FROM
```

## Two lockfiles — why, and how they stay honest

The dashboard ships **both** lockfiles, by necessity:

| Lockfile | Manager | Used by | Notes |
|---|---|---|---|
| `pnpm-lock.yaml` | pnpm | local dev (`pnpm install`), `make bootstrap` | **dev source of truth**; the only lockfile that honors `pnpm.patchedDependencies` (the `next-auth` `.js`-extension patch). |
| `package-lock.json` | npm | the production container image (`npm ci`, see `Dockerfile`) | the Next.js `node:20-alpine` image build path. |

The image build uses `npm ci` (not pnpm) because the standalone Next.js image
build was standardised on npm + `package-lock.json`; switching the image build
to pnpm is the unification path tracked as the follow-up below.

### Keeping the two in sync

After **any** dependency change you must regenerate **both** lockfiles:

```bash
pnpm install                                                   # updates pnpm-lock.yaml
npm install --package-lock-only --ignore-scripts --legacy-peer-deps  # updates package-lock.json
git add pnpm-lock.yaml package-lock.json
```

`scripts/check-lockfile-sync.mjs` runs in the `prebuild` chain and compares the
resolved version of every **direct** dependency / devDependency across the two
lockfiles. It is a **host-only** check: `pnpm-lock.yaml` is excluded from the
Docker build context (`.dockerignore`), so inside the image build the check
SKIPs cleanly (there is nothing to compare against), the same way the other
sibling-dependent prebuild checks SKIP in the image. It deliberately scopes to the direct-dependency closure (pnpm and
npm legitimately differ on transitive peer-dedupe and hoisting, so a full-tree
compare would be all false positives) — direct deps are where an out-of-sync
`pnpm add` / `npm install` actually diverges the dev and image builds.

> **Current mode: `--report` (non-blocking).** The two committed lockfiles
> carry a **pre-existing 38-direct-dependency version skew** (the dev pnpm tree
> resolved older patches of `react`, `react-dom`, the `@tiptap/*` editor suite,
> `fumadocs-*`, `motion`, `shiki`, `zustand`, `prettier`, etc. than the image
> npm tree). That means today the dev build and the shipped image run
> *different patch versions* of those packages. Converging the skew is a full
> dual-lockfile re-resolution with multiple defensible answers (bump dev up to
> the image versions, or pin the image down to dev), so it is tracked as a
> **scoped follow-up**, not done blind in this pass. Until it lands, the gate
> runs in `--report` mode so every build log surfaces the drift. **Flip the
> `prebuild` invocation to strict (drop `--report`) when the follow-up
> converges the lockfiles.**

### Patched dependency caveat

`pnpm.patchedDependencies` applies `patches/next-auth.patch` (adds explicit
`.js` extensions to `next/*` imports) **only under pnpm**. The npm/image path
pulls the unpatched `next-auth`; the Next.js bundler currently resolves the
extensionless imports without the patch, so the image build succeeds. This is
another reason the dev (pnpm) and image (npm) paths are not byte-identical, and
another input to the unification follow-up.

## Dead-code gate — knip (blocking)

`knip` runs at the end of the `prebuild` chain and is **blocking**
(non-zero exit fails the build). Config: `knip.json`.

Scope of the blocking gate (the categories enforced as `error`):

- **`files`** — a TS/TSX file in `project` scope reached by no entry point.
- **`dependencies`** / **`devDependencies`** — a declared package imported nowhere.
- **`unlisted`** — a dependency imported but not declared in `package.json`.
- **`unresolved`** — an import that resolves to nothing.
- **`binaries`** — a script invoking a binary not provided by any dependency.

`files` / `dependencies` / `devDependencies` were flipped to `error` in the
dead-code purge (dashboard#806 / #840). That pass deleted **147 dead files**
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
deliberate, reviewed per-symbol pass tracked as a scoped follow-up
(**dashboard#844**). When done, flip `exports` / `types` to `error`.

Precise, justified `ignoreDependencies` (not blanket):

- `pg` — used only by `scripts/shell-gc.mjs` (a dev GC helper, not in CI); `pg`
  is intentionally not a declared dependency.
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

1. **Lockfile unification** — converge `pnpm-lock.yaml` and
   `package-lock.json` (or move the image build onto pnpm so there is a single
   lockfile), resolve the patched-`next-auth` divergence, then flip
   `check-lockfile-sync.mjs` to strict in `prebuild`.
2. **Unused exports/types purge** (dashboard#844) — the dead-file and
   dead-dependency purge landed and `files` / `dependencies` / `devDependencies`
   are now `error`. The remaining `exports` (≈260) / `types` (≈491) categories
   stay `off` because they are entangled (kept-template `components/ui/**`
   exports, dual default+named export redundancy, co-located internal types);
   purge them per-symbol, then flip `exports` / `types` to `error`.
