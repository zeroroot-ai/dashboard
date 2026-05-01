#!/usr/bin/env node
/**
 * check-no-direct-daemon-grpc-bundle.mjs
 *
 * Postbuild guard for spec `zero-trust-hardening` Req 6.5: scan the
 * compiled Next.js client bundle (`.next/static/**\/*.js`) for any literal
 * symbol that would indicate a browser-side direct-daemon transport made
 * it past the source-level guards. The first regression — a
 * `createGrpcWebTransport` constructor inside `permissions-cache.ts` —
 * shipped in production for several releases because the source-level
 * guards searched for `gibson:50051`, not for the constructor name.
 *
 * The bundle is the canonical artifact users actually receive. If any of
 * the forbidden symbols appear here, the build fails before the artifact
 * is published.
 *
 * Forbidden symbols (literal-string match):
 *   - `createGrpcWebTransport`  — `@connectrpc/connect-web` browser entry
 *   - `getBrowserClient`        — the deleted helper from
 *                                  `src/lib/permissions-cache.ts`
 *   - `NEXT_PUBLIC_GIBSON_DAEMON_URL` — the retired env-var name
 *
 * Skipped silently when `.next/static/` does not exist (no build was
 * produced — there is nothing to scan).
 *
 * Wired into `scripts.postbuild` in package.json so every `pnpm build`
 * runs it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const STATIC_DIR = join(ROOT, ".next", "static");

const FORBIDDEN_SYMBOLS = [
  {
    needle: "createGrpcWebTransport",
    label:
      "createGrpcWebTransport — @connectrpc/connect-web entry must NOT appear in client bundles (use a server route)",
  },
  {
    needle: "getBrowserClient",
    label:
      "getBrowserClient — deleted helper from src/lib/permissions-cache.ts; reintroduction is a regression",
  },
  {
    needle: "NEXT_PUBLIC_GIBSON_DAEMON_URL",
    label:
      "NEXT_PUBLIC_GIBSON_DAEMON_URL — browsers must NOT receive a daemon endpoint; route through Envoy via a Next.js server route",
  },
];

function staticDirExists() {
  try {
    return statSync(STATIC_DIR).isDirectory();
  } catch {
    return false;
  }
}

function walkJs(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkJs(full, out);
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  if (!staticDirExists()) {
    console.log(
      "✓ check-no-direct-daemon-grpc-bundle: .next/static not found — skipping (run after `next build`)",
    );
    return 0;
  }

  const jsFiles = walkJs(STATIC_DIR);
  if (jsFiles.length === 0) {
    console.log(
      "✓ check-no-direct-daemon-grpc-bundle: no .js files found in .next/static — nothing to scan",
    );
    return 0;
  }

  const violations = [];
  for (const filePath of jsFiles) {
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const { needle, label } of FORBIDDEN_SYMBOLS) {
      if (content.includes(needle)) {
        violations.push({ file: filePath, needle, label });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `✓ check-no-direct-daemon-grpc-bundle: no forbidden symbols found in ${jsFiles.length} client bundle file(s)`,
    );
    return 0;
  }

  console.error(
    "\n❌ check-no-direct-daemon-grpc-bundle: forbidden direct-to-daemon symbol(s) found in client bundle!\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    contains: ${v.needle}`);
    console.error(`    why:      ${v.label}`);
  }
  console.error(
    "\nSpec zero-trust-hardening Req 6.5 — every dashboard call to the daemon",
  );
  console.error(
    "MUST go through Envoy. The browser bundle has no business holding a",
  );
  console.error(
    "gRPC-Web transport, the deleted `getBrowserClient` helper, or a",
  );
  console.error(
    "NEXT_PUBLIC_GIBSON_DAEMON_URL reference. Find the import that pulled",
  );
  console.error(
    "the symbol in and replace it with a fetch to a Next.js server route.\n",
  );
  return 1;
}

process.exit(main());
