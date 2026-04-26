#!/usr/bin/env node
/**
 * check-no-direct-daemon-grpc.mjs
 *
 * Build-time guard enforcing spec `dashboard-admin-via-envoy`: the dashboard's
 * admin RPC path goes through Envoy at `api.<domain>:<port>`, NOT directly to
 * the daemon's gRPC port. The direct path has been removed because its
 * maintenance burden (Node↔Go SPIFFE mTLS with rotating CAs) far exceeded its
 * value.
 *
 * This script scans every `.ts` / `.tsx` / `.mjs` file under `app/` and `src/`
 * for forbidden references and exits non-zero if any are found.
 *
 * Forbidden patterns:
 *   - Literal host:port pairs targeting the daemon directly:
 *       `gibson:50051`, `gibson:50002`, `gibson.gibson:50051`
 *   - The retired env-var name: `GIBSON_DAEMON_ADDRESS`
 *     (the replacement is `ADMIN_ENVOY_BASE_URL` which targets Envoy)
 *
 * Exemptions:
 *   - `node_modules`, `.next`, build output dirs
 *   - Test files (`*.test.*`, `*.spec.*`, `__tests__/`, `e2e/`) — these may
 *     assert the direct path is BLOCKED, so they're allowed to reference it.
 *   - Documentation / comment mentions — only code lines count. Lines that
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
const SCAN_DIRS = ["app", "src"];
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

const FORBIDDEN_PATTERNS = [
  { pattern: /\bgibson(?:\.[a-z0-9-]+)*:50051\b/, label: "direct daemon URL (gibson:50051)" },
  { pattern: /\bgibson(?:\.[a-z0-9-]+)*:50002\b/, label: "direct daemon URL (gibson:50002)" },
  { pattern: /\bgibson(?:\.[a-z0-9-]+)*:50001\b/, label: "direct daemon URL (gibson:50001) — harness callback port" },
  { pattern: /\bgibson(?:\.[a-z0-9-]+)*:50100\b/, label: "direct daemon URL (gibson:50100) — registration port" },
  { pattern: /\bGIBSON_DAEMON_ADDRESS\b/, label: "retired env var GIBSON_DAEMON_ADDRESS (use ADMIN_ENVOY_BASE_URL)" },
  // Spec: unified-identity-and-authorization Phase 4 — block reintroduction
  // of legacy auth credential plumbing. Replacement is Zitadel JWTs
  // forwarded as Authorization: Bearer headers.
  { pattern: /\bGSK_API_KEY\b|\bgsk_[a-zA-Z0-9]{8,}/, label: "gsk_ API key (gone — use Zitadel client_credentials)" },
  { pattern: /\bBETTER_AUTH_SECRET\b/, label: "BETTER_AUTH_SECRET (BetterAuth removed by Phase 4 — use Zitadel via Auth.js)" },
  { pattern: /\bBETTER_AUTH_URL\b/, label: "BETTER_AUTH_URL (BetterAuth removed by Phase 4 — use Zitadel via Auth.js)" },
];

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
    // e2e directory at repo root — skip entirely.
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
    // Skip pure-comment lines and JSDoc lines — we don't care about
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

function runScan() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    try {
      walk(abs, files);
    } catch {
      // Directory doesn't exist — fine, nothing to scan.
    }
  }
  const violations = files.flatMap(scanFile);
  if (violations.length === 0) {
    console.log(`check-no-direct-daemon-grpc.mjs: clean (${files.length} files scanned)`);
    return 0;
  }
  console.error(
    "❌ check-no-direct-daemon-grpc.mjs found forbidden direct-to-daemon references:\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    "\nWhy this exists: spec `dashboard-admin-via-envoy` routes admin RPCs",
  );
  console.error(
    "through Envoy instead of direct pod-to-pod TLS. The direct path was",
  );
  console.error(
    "removed along with 15+ hours of Node↔Go SPIFFE mTLS debugging.",
  );
  console.error(
    "Use ADMIN_ENVOY_BASE_URL + src/lib/spiffe/jwt-svid.ts instead.",
  );
  return 1;
}

function runSelftest() {
  const fixturePath = join(ROOT, "src", "__check_selftest_fixture.ts");
  const body = [
    "// Self-test fixture — intentionally references a forbidden pattern.",
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
