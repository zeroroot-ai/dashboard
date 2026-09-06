# ============================================================================
# Gibson Dashboard — uniform Makefile contract
# ============================================================================
# Implements the org-wide "just works" target contract from
# docs/architecture/open-core/RESTRUCTURE-QUALITY-BARS.md §1:
#
#     make bootstrap | build | test | check | image
#
# is the same set of commands in every repo. Dev tooling is pnpm (the
# committed pnpm-lock.yaml is the dev source of truth); the production
# container image is built from package-lock.json via `npm ci` (see Dockerfile
# and docs/build-and-lockfiles.md for why the dashboard ships both lockfiles
# and how they are kept in sync).
#
# The Node toolchain is pinned in .tool-versions (nodejs 20.x, matching the
# digest-pinned mirror base image in the Dockerfile). `make bootstrap` uses the
# committed pnpm-lock.yaml frozen so a clean checkout is reproducible.
# ============================================================================

# Prefer a repo-local pnpm via corepack when the shell does not already expose
# one (asdf/mise shims sometimes lag the active Node). Falls back to a bare
# `pnpm` on PATH.
PNPM ?= pnpm

IMAGE_NAME ?= ghcr.io/zeroroot-ai/dashboard
IMAGE_TAG  ?= dev

.PHONY: all bootstrap build test check image lint typecheck knip proto help

all: check build ## Run the full check suite then build

bootstrap: ## Install dependencies reproducibly from the committed pnpm lockfile
	$(PNPM) install --frozen-lockfile

build: ## Production build (runs the prebuild policy-guard + knip chain first)
	$(PNPM) build

test: ## Run the vitest unit suite
	$(PNPM) test run

check: ## Typecheck + knip (dead-code) + AST guards — the enforced gate (mirrors prebuild)
	$(PNPM) run check

lint: ## ESLint over the TS/TSX surface
	$(PNPM) lint

typecheck: ## tsc --noEmit
	$(PNPM) typecheck

knip: ## Dead-code / unused-dependency gate (blocking; see knip.json)
	$(PNPM) knip

proto: ## Regenerate the TS proto bindings (workstation-only; needs sibling repos)
	$(PNPM) proto:generate

image: ## Build the production container image (npm/package-lock.json path)
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) -f Dockerfile .

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
