#!/usr/bin/env node
/**
 * check-single-daemon-transport.mjs
 *
 * Build-time guard for dashboard#814 (E9, open-core migration / security
 * hardening): the dashboard constructs its ConnectRPC channel to the Gibson
 * daemon in exactly ONE module-private file,
 * `src/lib/gibson-client/transport.ts`. Every other call site obtains a typed
 * daemon client through the sanctioned wrappers (`userClient`,
 * `serviceClient`, `bootstrapClient`) re-exported from
 * `@/src/lib/gibson-client`. This gives the platform a single audited boundary
 * for every dashboard→daemon RPC (Envoy edge URL + SPIFFE mTLS + the
 * `x-gibson-tenant` / Authorization identity headers).
 *
 * Forbidden OUTSIDE the transport module:
 *   - importing the transport package `@connectrpc/connect-node`
 *     (or `@connectrpc/connect-web`)
 *   - calling the channel/transport constructors `createGrpcTransport(`,
 *     `createConnectTransport(`, or `createClient(`
 *
 * `ConnectError` / `Code` from `@connectrpc/connect` are error primitives,
 * not transport constructors, and remain freely importable everywhere.
 *
 * This complements:
 *   - the ESLint `no-restricted-imports` rule (.eslintrc.js), which gives the
 *     same feedback in-editor / on `pnpm lint`, and
 *   - `check-no-direct-daemon-grpc.mjs`, which guards daemon URLs / env vars.
 * The build chain relies on THIS script as the authoritative gate because
 * `pnpm lint` is not part of `pnpm prebuild`.
 *
 * Scans `.ts` / `.tsx` / `.mjs` / `.js` under `app/` and `src/`, skipping
 * test/spec/story files and build output. Pure-comment lines are ignored so
 * documentation referencing the old pattern does not trip the guard.
 *
 * Self-test mode: `--selftest` writes a synthetic violating fixture, asserts
 * the scan catches it, then deletes it.
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The single module permitted to own the transport. Path is relative to ROOT,
// normalised to forward slashes for cross-platform comparison.
const TRANSPORT_MODULE = "src/lib/gibson-client/transport.ts";

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
  {
    pattern: /from\s+['"]@connectrpc\/connect-node['"]/,
    label:
      "import of @connectrpc/connect-node (daemon transport package) outside the single transport module",
  },
  {
    pattern: /from\s+['"]@connectrpc\/connect-web['"]/,
    label:
      "import of @connectrpc/connect-web (daemon transport package) outside the single transport module",
  },
  {
    pattern: /\bcreateGrpcTransport\s*\(/,
    label: "createGrpcTransport(...) call outside the single transport module",
  },
  {
    pattern: /\bcreateConnectTransport\s*\(/,
    label: "createConnectTransport(...) call outside the single transport module",
  },
  {
    pattern: /\bcreateClient\s*\(/,
    label: "createClient(...) ConnectRPC call outside the single transport module",
  },
];

function normalise(absPath) {
  return relative(ROOT, absPath).split(sep).join("/");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (SKIP_FILE_MARKERS.some((m) => name.includes(m))) continue;
    if (full.includes(`${sep}e2e${sep}`)) continue;
    const dot = name.lastIndexOf(".");
    if (dot < 0 || !EXTENSIONS.has(name.slice(dot))) continue;
    out.push(full);
  }
  return out;
}

function scanFile(path) {
  // The transport module is the one sanctioned owner, exempt it entirely.
  if (normalise(path) === TRANSPORT_MODULE) return [];
  const src = readFileSync(path, "utf8");
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    // Skip pure-comment lines so docs / removal notes don't trip the guard.
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
      // Directory absent, nothing to scan.
    }
  }
  const violations = files.flatMap(scanFile);
  if (violations.length === 0) {
    console.log(
      `check-single-daemon-transport.mjs: clean (${files.length} files scanned; transport owned solely by ${TRANSPORT_MODULE})`,
    );
    return 0;
  }
  console.error(
    "❌ check-single-daemon-transport.mjs found daemon-transport construction outside the single transport module:\n",
  );
  for (const v of violations) {
    console.error(`  ${normalise(v.file)}:${v.line}, ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    `\nWhy this exists: dashboard#814 (E9) routes every dashboard→daemon RPC through ONE`,
  );
  console.error(
    `module-private transport in ${TRANSPORT_MODULE}. Callers must obtain a typed client`,
  );
  console.error(
    "via userClient / serviceClient / bootstrapClient (re-exported from @/src/lib/gibson-client),",
  );
  console.error(
    "never by constructing their own ConnectRPC channel. This keeps a single audited boundary",
  );
  console.error(
    "for the Envoy URL, SPIFFE mTLS, and the x-gibson-tenant / Authorization identity headers.",
  );
  return 1;
}

function runSelftest() {
  const fixturePath = join(ROOT, "src", "__single_transport_selftest_fixture.ts");
  const body = [
    "// Self-test fixture, intentionally constructs a forbidden transport.",
    "import { createGrpcTransport } from '@connectrpc/connect-node';",
    "export const t = createGrpcTransport({ baseUrl: 'https://example' });",
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
      `check-single-daemon-transport.mjs --selftest: OK (caught ${result.length} violation(s))`,
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
