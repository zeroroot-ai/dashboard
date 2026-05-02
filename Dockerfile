# ============================================================================
# Gibson Dashboard Multi-Stage Dockerfile
# ============================================================================
# Production-ready Next.js container using standalone output.
#
# Build from dashboard directory:
#   docker build -t gibson-dashboard:dev .
# ============================================================================

# ============================================================================
# Stage 1: Dependencies - Install node modules
# ============================================================================
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps

WORKDIR /app

# Copy dependency manifests for layer caching
COPY package.json package-lock.json ./

# Install production + dev dependencies (needed for build). --ignore-scripts
# blocks arbitrary postinstall scripts; npm rebuild then runs install for the
# specific native modules that need per-arch binaries extracted (multi-arch
# Docker buildx builds linux/arm64 via QEMU and needs the right .node binary).
RUN npm ci --ignore-scripts --legacy-peer-deps && \
    npm rebuild lightningcss

# ============================================================================
# Stage 2: Builder - Build Next.js application
# ============================================================================
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time placeholders for modules that validate env vars at import time.
# These are NOT baked into the runtime image — real values come from K8s secrets.
ENV AUTH_SECRET="build-placeholder"
ENV NEXTAUTH_SECRET="build-placeholder"
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# The prebuild gen-plans step reads enterprise/platform/tenant-operator/plans/plans.yaml
# from the repo root, which is outside this Dockerfile's build context. The host
# build runs gen-plans beforehand; inside the container we consume the already
# generated src/generated/plans.ts.
ENV SKIP_GEN_PLANS=1
# check-dashboard-rbac-minimal.mjs runs `helm template` to diff chart RBAC.
# helm is not installed in this Node.js image; skip it here — the check runs
# on the dev host via `npm run prebuild` before pushing. The underlying chart
# RBAC is still enforced by the allowlist at commit time.
# Spec: signup-zitadel-permissions-fix (Docker build fix for auth-resolution-hardening).
ENV SKIP_DASHBOARD_RBAC_CHECK=1
# gen-authz-registry.mjs walks the SDK + gibson proto trees via workspace
# synthesis (see scripts/gen-authz-registry.mjs and proto-generate.mjs). Those
# trees are sibling repos outside this Dockerfile's build context, and the
# script needs `go list -m` against gibson's go.mod to find the SDK. Neither
# is available in the node:20-alpine builder. The host build runs the full
# regen + drift gate via `pnpm prebuild`; inside the container we consume the
# committed src/gen/authz/registry.ts.
# Spec: cross-repo-cohesion-fixes Requirement 2.
ENV SKIP_GEN_AUTHZ_REGISTRY=1
ENV SKIP_AUTHZ_REGISTRY_CHECK=1

# Build the standalone application
RUN npm run build

# ============================================================================
# Stage 3: Runtime - Minimal production image
# ============================================================================
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user matching Helm deployment spec (UID 1001)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

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
