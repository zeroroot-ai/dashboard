#!/usr/bin/env node
/**
 * check-required-build-env.mjs
 *
 * Build-time guard for env vars that `next.config.ts` (and other build-time
 * surfaces like generated content) evaluate BEFORE the Next.js Node server
 * starts. Those values cannot be validated by the runtime
 * `validateEnv()` hook in instrumentation.ts, by the time the hook runs,
 * the rewrite has already been baked into the build artifact.
 *
 * Spec: one-code-path (deploy#186), slice deploy#206.
 *
 * Behaviour: when this script is invoked WITHOUT `CI=1` or
 * `STRICT_BUILD_ENV=1`, it is a no-op (so a developer running `pnpm build`
 * locally without a fully-populated env is not blocked). When CI runs
 * `next build` against the production-bound codepath, set `STRICT_BUILD_ENV=1`
 * in the build environment and the script will fail the image build if
 * any of the required build-time vars are missing.
 *
 * Why opt-in: developers run `pnpm build` daily on workstation envs that
 * legitimately do not have the production daemon URL set. The script's job
 * is to be a CI safety net, not a local-dev tripwire.
 *
 * Wired into the `prebuild` chain so it runs before `next build` whenever
 * the prebuild chain is invoked.
 */

const STRICT = process.env.CI === '1' || process.env.STRICT_BUILD_ENV === '1';

// Build-time required env vars. KEEP IN SYNC with src/lib/env-validator.ts -
// every entry here is a subset of REQUIRED_ENV that next.config.ts (or other
// build-time evaluators) read at `next build` time.
const BUILD_TIME_REQUIRED = ['GIBSON_API_URL'];

if (!STRICT) {
  console.log(
    '[check-required-build-env] non-strict mode (set CI=1 or STRICT_BUILD_ENV=1 to enforce), skipping',
  );
  process.exit(0);
}

const missing = BUILD_TIME_REQUIRED.filter((name) => !process.env[name]);

if (missing.length === 0) {
  console.log(
    `[check-required-build-env] OK, ${BUILD_TIME_REQUIRED.length} build-time required env var(s) present`,
  );
  process.exit(0);
}

console.error(
  `\n[check-required-build-env] FAIL: missing ${missing.length} build-time required env var(s):\n`,
);
for (const name of missing) {
  console.error(`  - ${name}`);
}
console.error(`
These env vars are read by next.config.ts AT BUILD TIME (and again at server
start before instrumentation.ts runs). Set them in the CI build job /
Dockerfile build args before invoking 'next build'.

See src/lib/env-validator.ts for the full required-env catalogue.
`);
process.exit(1);
