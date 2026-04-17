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
FROM node:20-alpine AS deps

WORKDIR /app

# Copy dependency manifests for layer caching
COPY package.json package-lock.json ./

# Install production + dev dependencies (needed for build). --ignore-scripts
# blocks arbitrary postinstall scripts; npm rebuild then runs install for the
# specific native modules that need per-arch binaries extracted (multi-arch
# Docker buildx builds linux/arm64 via QEMU and needs the right .node binary).
RUN npm ci --ignore-scripts && \
    npm rebuild lightningcss

# ============================================================================
# Stage 2: Builder - Build Next.js application
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time placeholders for modules that validate env vars at import time.
# These are NOT baked into the runtime image — real values come from K8s secrets.
ENV BETTER_AUTH_SECRET="build-placeholder"
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# Build the standalone application
RUN npm run build

# ============================================================================
# Stage 3: Runtime - Minimal production image
# ============================================================================
FROM node:20-alpine AS runner

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
