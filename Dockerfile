# ============================================================================
# Gibson Dashboard Multi-Stage Dockerfile
# ============================================================================
# Production-ready Next.js container using standalone output.
#
# Build from dashboard directory:
#   docker build -t gibson-dashboard:dev .
# ============================================================================
#
# Base image is digest-pinned to the org mirror (RESTRUCTURE-QUALITY-BARS §1:
# "Digest-pinned, mirror-sourced base images everywhere — tag pins are not
# reproducible"). The pinned digest is the multi-arch manifest-list (OCI index)
# digest of ghcr.io/zeroroot-ai/mirror/node:20-alpine — the index digest, NOT a
# per-arch manifest digest, because this Dockerfile is built multi-arch
# (linux/amd64 + linux/arm64 via buildx). The node major must stay in lockstep
# with .tool-versions (`nodejs 20.x`) and the mirror-list entry in
# zeroroot-ai/.github. To re-pin after a mirror refresh:
#   docker buildx imagetools inspect ghcr.io/zeroroot-ai/mirror/node:20-alpine
# and copy the top-level (index) Digest into every FROM below.
# ============================================================================

# ============================================================================
# Stage 1: Dependencies - Install node modules
# ============================================================================
# ghcr.io/zeroroot-ai/mirror/node:20-alpine
FROM ghcr.io/zeroroot-ai/mirror/node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps

WORKDIR /app

# Copy dependency manifests for layer caching
COPY package.json package-lock.json .npmrc ./

# Install production + dev dependencies (needed for build). --ignore-scripts
# blocks arbitrary postinstall scripts; npm rebuild then runs install for the
# specific native modules that need per-arch binaries extracted (multi-arch
# Docker buildx builds linux/arm64 via QEMU and needs the right .node binary).
#
# @zeroroot-ai/brand (dashboard#915) is fetched from GitHub Packages, not the
# public npm registry, and needs an auth token even though the package is
# readable org-wide (npm.pkg.github.com requires a bearer token for every
# install regardless of package visibility). The committed .npmrc declares
# `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`; unlike pnpm, npm DOES
# expand env vars in a project-level .npmrc, so passing NODE_AUTH_TOKEN into
# this RUN's shell environment (not baked as an image ENV/ARG) is enough.
# `required=false` so a plain local `docker build` without the secret still
# works if ambient registry auth exists (e.g. a workstation-level ~/.npmrc).
RUN --mount=type=secret,id=npm_token,target=/run/secrets/npm_token,required=false \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null || true)" \
    npm ci --ignore-scripts --legacy-peer-deps && \
    npm rebuild lightningcss

# ============================================================================
# Stage 2: Builder - Build Next.js application
# ============================================================================
# ghcr.io/zeroroot-ai/mirror/node:20-alpine
FROM ghcr.io/zeroroot-ai/mirror/node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# DASHBOARD_HSTS_DISABLED — build-arg so local :dev image builds (make
# restart-dashboard) can disable HSTS in routes-manifest.json (baked by
# `next build`). Next.js bakes next.config.ts headers() at build time;
# the runtime env var has no effect. Production/CI builds omit this arg
# so HSTS is emitted. kind dev builds pass --build-arg DASHBOARD_HSTS_DISABLED=1.
ARG DASHBOARD_HSTS_DISABLED=""
ENV DASHBOARD_HSTS_DISABLED=${DASHBOARD_HSTS_DISABLED}

# Build-time placeholders for modules that validate env vars at import time.
# These are NOT baked into the runtime image — real values come from K8s secrets.
ENV AUTH_SECRET="build-placeholder"
ENV NEXTAUTH_SECRET="build-placeholder"
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# No SKIP_GEN_* / SKIP_*_FRESH_CHECK envs any more (dashboard#1019).
#
# `prebuild` used to run each generator immediately before its own freshness
# gate, so every gate diffed the generator's output against the generator's
# output and could never fail. The generators are out of `prebuild` now, and
# the four gates (plans, stripe tiers, authz registry, mission schema) compare
# the COMMITTED artifact against freshly generated output.
#
# The polyrepo siblings those generators read — deploy/helm/gibson-operators/
# files/, opensource/sdk/, enterprise/platform/gibson/ — are still absent from
# this build context. The gates now discover that by asking each generator
# `--probe`, and degrade to their STRUCTURAL pass: the committed artifact must
# exist, be non-empty, parse, and carry its generator's header. That much is
# verified here; the byte-diff happens on the workstation and in polyrepo CI.
# Being told to look away is no longer an option, which is the point.
#
# check-dashboard-rbac-minimal.mjs runs `helm template` to diff chart RBAC.
# helm is not installed in this Node.js image; skip it here — the check runs
# on the dev host via `npm run prebuild` before pushing. The underlying chart
# RBAC is still enforced by the allowlist at commit time.
# Spec: signup-zitadel-permissions-fix (Docker build fix for auth-resolution-hardening).
ENV SKIP_DASHBOARD_RBAC_CHECK=1

# Build the standalone application. All sibling-sourced generated files
# (plans.ts, stripe_gen.ts, authz registry, proto bindings) are committed, and
# the freshness gates verify them structurally here (see the note above), so the
# build performs no cross-repo fetch. The `ghtoken` BuildKit secret is mounted non-required for
# backward compatibility (any future build-time fetch can read it via
# GITHUB_TOKEN); the build no longer fails when it is absent.
RUN --mount=type=secret,id=ghtoken,target=/run/secrets/ghtoken,required=false \
    GITHUB_TOKEN="$(cat /run/secrets/ghtoken 2>/dev/null || true)" npm run build

# ============================================================================
# Stage 3: Runtime - Minimal production image
# ============================================================================
# ghcr.io/zeroroot-ai/mirror/node:20-alpine
FROM ghcr.io/zeroroot-ai/mirror/node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user matching Helm deployment spec (UID 1001)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Strip the bundled package managers from the RUNTIME image.
#
# Nothing in this stage uses them. The entrypoint is `node server.js` against
# the Next standalone output, and the healthcheck shells out to wget; npm, npx,
# corepack and yarn are present only because the node base image ships them.
# The build stages are unaffected — they run `npm ci` / `npm run build` in the
# `deps` and `builder` stages, which are discarded and never scanned.
#
# They are worth deleting for two reasons:
#
#  1. Attack surface. A production container has no business carrying a package
#     manager that can fetch and execute arbitrary code from the network. If
#     anything ever achieves execution in this image, npm is a ready-made way
#     to pull down a second stage.
#
#  2. Every CVE in npm's ~200 vendored dependencies is charged to this image.
#     npm bundles its whole dependency tree under
#     /usr/local/lib/node_modules/npm/node_modules/, so the image scan reports
#     tar, minimatch, cross-spawn, glob, brace-expansion, ip-address and diff
#     advisories against a CLI that is never invoked at runtime. That was 17 of
#     the repo's open Trivy alerts (9 high, 2 medium, 2 low, plus 4 more tar
#     highs). None was reachable, and none could be fixed by patching the app —
#     the only lever is npm's own version, which is pinned by the base image.
#     Deleting the CLI removes the packages, and with them the findings, rather
#     than annotating them as unreachable one advisory at a time.
#
# Must run before `USER nextjs` — the files are root-owned.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /opt/yarn-* \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
 && ! command -v npm >/dev/null 2>&1 \
 && node --version

# Copy standalone build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
