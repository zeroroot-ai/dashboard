#!/usr/bin/env node
/**
 * check-no-direct-daemon-grpc.mjs
 *
 * Build-time guard enforcing specs `dashboard-admin-via-envoy` and
 * `zero-trust-hardening` (Req 6.3): the dashboard's daemon RPC path goes
 * through Envoy at `api.<domain>:<port>`, NOT directly to the daemon's
 * gRPC port. The direct path has been removed because its maintenance
 * burden (Node↔Go SPIFFE mTLS with rotating CAs) far exceeded its value.
 *
 * This script scans every `.ts` / `.tsx` / `.mjs` file under the dashboard's
 * roots (`app/`, `src/`, with `src/components/**` extended in
 * zero-trust-hardening to cover modules transitively imported into client
 * bundles) for forbidden references and exits non-zero if any are found.
 *
 * Forbidden patterns:
 *   - Literal host:port pairs targeting the daemon directly:
 *       `gibson:50051`, `gibson:50002`, `gibson.gibson:50051`
 *   - Kubernetes-style FQDN forms targeting daemon ports:
 *       `gibson.<ns>.svc.cluster.local:<daemon-port>`,
 *       `gibson.<ns>.svc:<daemon-port>`,
 *       `gibson-daemon.<ns>...:<daemon-port>`
 *   - The retired env-var name: `GIBSON_DAEMON_ADDRESS`
 *     (the replacement is `ADMIN_ENVOY_BASE_URL` which targets Envoy)
 *   - Any `NEXT_PUBLIC_*` env var whose value at script-run time matches a
 *     daemon-shaped URL pattern (Req 6.3, catches a regression where an
 *     ops engineer publishes a daemon URL into a NEXT_PUBLIC_* name).
 *
 * Exemptions:
 *   - `node_modules`, `.next`, build output dirs
 *   - Test files (`*.test.*`, `*.spec.*`, `__tests__/`, `e2e/`), these may
 *     assert the direct path is BLOCKED, so they're allowed to reference it.
 *   - Documentation / comment mentions, only code lines count. Lines that
 *     start with `//` or are inside `/* ... *\/` blocks are skipped.
 *
 * Self-test mode: `--selftest` writes a synthetic violating fixture under
 * `src/__check_selftest_fixture.ts`, runs the scan, asserts it catches the
 * fixture, then deletes it. Exit 0 if the guard works; non-zero if not.
 *
 * Wired into `scripts.prebuild` in package.json so every `npm run build` runs
 * it. CI reruns as part of the same chain.
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Scan roots: extended in zero-trust-hardening Req 6.3 from the original
// `["app", "src"]` to also include the repo-root `components/`, `lib/`,
// `hooks/` directories and the loose top-level files (auth.ts, middleware.ts,
// mdx-components.tsx, instrumentation.ts), any of which can be transitively
// imported into a client bundle.
const SCAN_DIRS = ["app", "src", "components", "lib", "hooks"];
const SCAN_FILES = [
  "auth.ts",
  "middleware.ts",
  "mdx-components.tsx",
  "instrumentation.ts",
];
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "__tests__",
]);
const SKIP_FILE_MARKERS = [".test.", ".spec.", ".stories."];

// Daemon ports we forbid in browser-bundled code. Any literal `<daemon-host>:<port>`
// pair from this set is a violation regardless of how the host is spelled
// (short name, namespaced FQDN, cluster-suffixed FQDN).
const DAEMON_PORTS = ["50001", "50002", "50051", "50100"];
const PORT_LABELS = {
  "50001": "harness callback port",
  "50002": "admin gRPC port",
  "50051": "primary gRPC port",
  "50100": "registration port",
};

// Daemon hostname patterns we recognise. The shape is intentionally
// permissive, it catches `gibson`, `gibson.<ns>`, `gibson.<ns>.svc`,
// `gibson.<ns>.svc.cluster.local`, plus the legacy `gibson-daemon.<...>`
// variant. The trailing port is required so that bare references to the
// `gibson` package name or the `gibson.io` doc/comment string never
// trigger.
const DAEMON_HOST_BODY = "(?:gibson(?:-daemon)?(?:\\.[a-z0-9-]+)*)";

function buildPortPatterns() {
  return DAEMON_PORTS.map((port) => ({
    pattern: new RegExp(`\\b${DAEMON_HOST_BODY}:${port}\\b`),
    label: `direct daemon URL (gibson host : ${port}), ${PORT_LABELS[port]}`,
  }));
}

const FORBIDDEN_PATTERNS = [
  ...buildPortPatterns(),
  { pattern: /\bGIBSON_DAEMON_ADDRESS\b/, label: "retired env var GIBSON_DAEMON_ADDRESS (use ADMIN_ENVOY_BASE_URL)" },
  // Spec zero-trust-hardening Req 6.1, 6.2, the browser must never read a
  // NEXT_PUBLIC_* variable holding a daemon URL. The previous
  // permissions-cache.ts regression slipped past this guard because the
  // literal port wasn't in the source, the value lived in the env var
  // only. Catch the *name* here; the env-value scan further down catches
  // anyone trying to ship a daemon URL via a different env-name.
  { pattern: /\bNEXT_PUBLIC_GIBSON_DAEMON_URL\b/, label: "NEXT_PUBLIC_GIBSON_DAEMON_URL (browser must NOT hold a daemon URL, call /api/auth/my-permissions or another server route instead)" },
  // Spec: unified-identity-and-authorization Phase 4, block reintroduction
  // of legacy auth credential plumbing. Replacement is Zitadel JWTs
  // forwarded as Authorization: Bearer headers.
  { pattern: /\bGSK_API_KEY\b|\bgsk_[a-zA-Z0-9]{8,}/, label: "gsk_ API key (gone, use Zitadel client_credentials)" },
  { pattern: /\bBETTER_AUTH_SECRET\b/, label: "BETTER_AUTH_SECRET (BetterAuth removed by Phase 4, use Zitadel via Auth.js)" },
  { pattern: /\bBETTER_AUTH_URL\b/, label: "BETTER_AUTH_URL (BetterAuth removed by Phase 4, use Zitadel via Auth.js)" },
];

// Daemon-shaped URL pattern used by the env-value scan. We accept any
// scheme (http, https, grpc, grpc+tls, gRPC-Web URLs, plain host:port)
// and require either a daemon-shaped host OR a daemon-shaped port. The
// pattern is intentionally tighter than FORBIDDEN_PATTERNS, env vars
// can hold legitimate base URLs, so we only flag values that look like
// they target the daemon's internal address.
const DAEMON_URL_VALUE_PATTERN = new RegExp(
  `(?:^|[^a-z0-9])${DAEMON_HOST_BODY}:(?:${DAEMON_PORTS.join("|")})(?:[^0-9]|$)`,
  "i",
);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    // Skip test + story files.
    if (SKIP_FILE_MARKERS.some((m) => name.includes(m))) continue;
    // e2e directory at repo root, skip entirely.
    if (full.includes(`${sep}e2e${sep}`)) continue;
    // Only scan the extensions we care about.
    const dot = name.lastIndexOf(".");
    if (dot < 0 || !EXTENSIONS.has(name.slice(dot))) continue;
    out.push(full);
  }
  return out;
}

function scanFile(path) {
  const src = readFileSync(path, "utf8");
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip pure-comment lines and JSDoc lines, we don't care about
    // forbidden patterns mentioned in a comment explaining what was
    // removed. A trailing `// ...` after real code on the same line is
    // tolerated as a false positive; in practice that doesn't happen for
    // `gibson:50051` URLs and `GIBSON_DAEMON_ADDRESS` identifiers.
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      if (pattern.test(raw)) {
        violations.push({ file: path, line: i + 1, text: raw.trim(), label });
      }
    }
  }
  return violations;
}

/**
 * Scan `process.env` for any `NEXT_PUBLIC_*` variable whose value looks
 * like a daemon URL. The previous regression (zero-trust-hardening Req
 * 6.1) hid in plain sight because only the env-var *name* was in the
 * source, the daemon URL itself never appeared as a literal. This scan
 * runs at build time when ops engineers wire env vars into the
 * production environment; the build fails before a bundle that would
 * leak the URL to browsers ever ships.
 *
 * Skipped when no `NEXT_PUBLIC_*` env var is set (typical local dev).
 */
function scanPublicEnvVars() {
  const violations = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    if (!value) continue;
    if (DAEMON_URL_VALUE_PATTERN.test(value)) {
      violations.push({
        file: `<env>`,
        line: 0,
        text: `${name}=<redacted; matches daemon-shaped URL pattern>`,
        label: `NEXT_PUBLIC_* env var ${name} holds a daemon-shaped URL, browsers must NOT receive a daemon endpoint`,
      });
    }
  }
  return violations;
}

function runScan() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    try {
      walk(abs, files);
    } catch {
      // Directory doesn't exist, fine, nothing to scan.
    }
  }
  for (const name of SCAN_FILES) {
    const abs = join(ROOT, name);
    try {
      const st = statSync(abs);
      if (st.isFile()) files.push(abs);
    } catch {
      // File doesn't exist, fine.
    }
  }
  const fileViolations = files.flatMap(scanFile);
  const envViolations = scanPublicEnvVars();
  const violations = [...fileViolations, ...envViolations];
  if (violations.length === 0) {
    console.log(
      `check-no-direct-daemon-grpc.mjs: clean (${files.length} files scanned, ${
        Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_")).length
      } NEXT_PUBLIC_* env vars inspected)`,
    );
    return 0;
  }
  console.error(
    "❌ check-no-direct-daemon-grpc.mjs found forbidden direct-to-daemon references:\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}, ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    "\nWhy this exists: specs `dashboard-admin-via-envoy` and `zero-trust-hardening`",
  );
  console.error(
    "route every dashboard→daemon RPC through Envoy at `api.<domain>:<port>`. The",
  );
  console.error(
    "direct path is removed; SPIFFE mTLS lives between Envoy and the daemon, not",
  );
  console.error(
    "between the dashboard pod and the daemon. Browsers must never hold a daemon URL.",
  );
  console.error(
    "Use ADMIN_ENVOY_BASE_URL + src/lib/gibson-client.ts (userClient / serviceClient) instead.",
  );
  return 1;
}

function runSelftest() {
  const fixturePath = join(ROOT, "src", "__check_selftest_fixture.ts");
  const body = [
    "// Self-test fixture, intentionally references a forbidden pattern.",
    "// The scan SHOULD catch this and exit non-zero.",
    "export const DAEMON_URL = 'http://gibson:50051';",
    "",
  ].join("\n");
  writeFileSync(fixturePath, body);
  try {
    const result = scanFile(fixturePath);
    if (result.length === 0) {
      console.error(
        "❌ selftest FAILED: scanner did not catch the synthetic violation.",
      );
      return 1;
    }
    console.log(
      `check-no-direct-daemon-grpc.mjs --selftest: OK (caught ${result.length} violation)`,
    );
    return 0;
  } finally {
    try {
      unlinkSync(fixturePath);
    } catch {
      // best-effort
    }
  }
}

const mode = process.argv[2];
process.exit(mode === "--selftest" ? runSelftest() : runScan());
