#!/usr/bin/env node
/*
 * check-csp.mjs
 *
 * CSP gate for the Gibson Dashboard build pipeline.
 *
 * ## What went wrong before
 *
 * The previous revision of this file could not fail. It banned
 * `'unsafe-inline'` / `'unsafe-eval'` inside `script-src`, but:
 *
 *   - the only caller of `walk()` iterated `ADDITIONAL_CSP_SOURCES`, which was
 *     an empty array, so the build output under `.next/` was never opened; and
 *   - `checkMiddleware()` returned early when middleware.ts declared no CSP,
 *     which was the normal state, so it never inspected anything either.
 *
 * Both scans ran over zero bytes and the script exited 0 unconditionally.
 * Worse, a guard shaped purely as "ban bad tokens" is vacuous when there is no
 * CSP at all: deleting the policy outright was a clean pass.
 *
 * ## What this checks now
 *
 * The policy is a static header set in `next.config.ts` `headers()` and
 * exported as `CONTENT_SECURITY_POLICY`. This guard binds to that symbol and
 * asserts:
 *
 *   1. EXISTENCE, `headers()` serves a `Content-Security-Policy` on the
 *      `/(.*)` catch-all rule. A policy that does not cover every response is
 *      not a baseline.
 *   2. `default-src 'self'`
 *   3. `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`
 *   4. `form-action 'self'`
 *   5. `connect-src` contains neither a bare `*` nor a bare `https:` scheme
 *      source, either would let exfiltration go anywhere.
 *   6. `'unsafe-eval'` appears only behind the dev branch.
 *   7. BUILD OUTPUT, `.next/` is walked for real and `'unsafe-eval'` must not
 *      appear in any compiled CSP (a production build has `isDev === false`).
 *      When `.next/routes-manifest.json` exists it must carry a CSP header,
 *      which is what proves the policy survived compilation.
 *
 * ## Deliberately NOT checked: 'unsafe-inline' in script-src
 *
 * The policy is static in `headers()` rather than nonce-based in middleware,
 * because middleware does not run on every response, its matcher excludes
 * `_next/static`, `api/auth`, `api/health` and `api/signup`, and a baseline
 * must cover those. A static header cannot carry a per-response nonce, so
 * `script-src` keeps `'unsafe-inline'`. That is a known, accepted trade, and a
 * guard that failed on it would simply be disabled. The directives above are
 * what actually bound the blast radius, so those are what is asserted.
 *
 * ## Self-test
 *
 *   node scripts/check-csp.mjs --selftest
 *
 * Builds throwaway fixtures in a temp dir (never the real repo, other agents
 * may be editing next.config.ts) and asserts the guard rejects every defect it
 * claims to catch and accepts a compliant policy.
 *
 * Exit codes: 0 clean, 1 violation, 2 unexpected error.
 */

import { readdir, readFile, stat, mkdir, writeFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_NAME = "check-csp";
const DASHBOARD_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The file that owns the policy. */
const CONFIG_FILE = "next.config.ts";
/** The exported symbol the policy lives in. */
const CSP_SYMBOL = "CONTENT_SECURITY_POLICY";
/** The route rule the policy must be attached to. */
const CATCH_ALL_SOURCE = "/(.*)";

/** directive -> exact required value. */
const REQUIRED_EXACT = {
  "default-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'none'",
  "frame-ancestors": "'none'",
  "form-action": "'self'",
};

/** Build output roots walked for a compiled CSP. */
const BUILD_SCAN_DIRS = [join(".next", "server"), join(".next", "static")];
const ROUTES_MANIFEST = join(".next", "routes-manifest.json");

const CSP_HEADER_NEEDLE = "content-security-policy";
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "test-results",
  "playwright-report",
  "coverage",
  "cache",
]);

function toPosix(p) {
  return p.split(sep).join("/");
}

async function readIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "EISDIR")) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Parsing next.config.ts
// ---------------------------------------------------------------------------

/**
 * Parse the config and pull out:
 *   - the CSP directive list, with simple `const X = "..."` references resolved
 *     so `connect-src ${STRIPE_CONNECT}` can actually be inspected
 *   - whether a Content-Security-Policy header is attached to the catch-all
 */
function parseConfig(sourceText, fileName) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);

  const stringConsts = new Map();
  let cspNode = null;
  const headerListNames = new Set();
  let catchAllHeadersRef = null;

  const collectConsts = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        if (ts.isStringLiteral(decl.initializer) || ts.isNoSubstitutionTemplateLiteral(decl.initializer)) {
          stringConsts.set(name, decl.initializer.text);
        }
        if (name === CSP_SYMBOL) cspNode = decl.initializer;
        // A header array: [{ key: "...", value: ... }, ...]
        if (ts.isArrayLiteralExpression(decl.initializer)) {
          if (decl.initializer.getText(sf).toLowerCase().includes(CSP_HEADER_NEEDLE)) {
            headerListNames.add(name);
          }
        }
      }
    }
    ts.forEachChild(node, collectConsts);
  };
  collectConsts(sf);

  // Find the headers() rule whose `source` is the catch-all and record what it
  // serves, so we can confirm the CSP covers every response.
  const findCatchAll = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let source = null;
      let headersText = null;
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
        const key = prop.name.getText(sf).replace(/["']/g, "");
        if (key === "source" && ts.isStringLiteral(prop.initializer)) {
          source = prop.initializer.text;
        }
        if (key === "headers") headersText = prop.initializer.getText(sf);
      }
      if (source !== null && headersText !== null && source === CATCH_ALL_SOURCE) {
        catchAllHeadersRef = headersText;
      }
    }
    ts.forEachChild(node, findCatchAll);
  };
  findCatchAll(sf);

  // Resolve the CSP array into directive strings.
  const directives = [];
  let cspRawText = "";
  if (cspNode) {
    cspRawText = cspNode.getText(sf);
    let arrayNode = cspNode;
    // `[...].join("; ")` -> take the array
    if (ts.isCallExpression(cspNode) && ts.isPropertyAccessExpression(cspNode.expression)) {
      arrayNode = cspNode.expression.expression;
    }
    if (ts.isArrayLiteralExpression(arrayNode)) {
      for (const el of arrayNode.elements) {
        let text;
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
          text = el.text;
        } else {
          // Template with substitutions: rebuild, resolving simple consts.
          text = el.getText(sf).replace(/^`|`$/g, "");
          text = text.replace(/\$\{([^}]*)\}/g, (whole, expr) => {
            const trimmed = expr.trim();
            if (stringConsts.has(trimmed)) return stringConsts.get(trimmed);
            // Keep conditional expressions verbatim so the dev-branch check can
            // still see them.
            return `\${${trimmed}}`;
          });
        }
        directives.push({ text, raw: el.getText(sf) });
      }
    }
  }

  return { directives, cspRawText, catchAllHeadersRef, headerListNames, hasCspSymbol: cspNode !== null };
}

function directiveValue(directives, name) {
  const hit = directives.find((d) => d.text.trim().toLowerCase().startsWith(name + " "));
  if (!hit) return null;
  return hit.text.trim().slice(name.length).trim();
}

// ---------------------------------------------------------------------------
// Build output
// ---------------------------------------------------------------------------

async function walkBuildOutput(dir, root, hits, counter) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkBuildOutput(abs, root, hits, counter);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(js|mjs|cjs|json|html)$/i.test(entry.name)) continue;

    let info;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    if (info.size > MAX_SCAN_BYTES) continue;

    const content = await readIfExists(abs);
    if (content === null) continue;
    counter.filesScanned += 1;
    const lower = content.toLowerCase();
    if (!lower.includes(CSP_HEADER_NEEDLE)) continue;
    counter.cspBearingFiles += 1;
    if (lower.includes("'unsafe-eval'")) {
      hits.push({
        file: toPosix(relative(root, abs)),
        reason:
          "compiled CSP contains 'unsafe-eval'. It is permitted only behind the " +
          "dev branch, so a production build must never emit it.",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function runScan(root) {
  const hits = [];
  const counter = { filesScanned: 0, cspBearingFiles: 0 };

  const configPath = join(root, CONFIG_FILE);
  const configText = await readIfExists(configPath);

  if (configText === null) {
    hits.push({ file: CONFIG_FILE, reason: `${CONFIG_FILE} not found` });
  } else {
    const parsed = parseConfig(configText, configPath);

    if (!parsed.hasCspSymbol || parsed.directives.length === 0) {
      hits.push({
        file: CONFIG_FILE,
        reason:
          `no \`${CSP_SYMBOL}\` directive list found. The dashboard must ship a ` +
          `Content-Security-Policy.`,
      });
    } else {
      // 1. attached to the catch-all
      if (parsed.catchAllHeadersRef === null) {
        hits.push({
          file: CONFIG_FILE,
          reason:
            `headers() has no \`source: "${CATCH_ALL_SOURCE}"\` rule, so the CSP ` +
            `does not cover every response`,
        });
      } else {
        const ref = parsed.catchAllHeadersRef;
        const servesCsp =
          ref.toLowerCase().includes(CSP_HEADER_NEEDLE) ||
          [...parsed.headerListNames].some((n) => new RegExp(`\\b${n}\\b`).test(ref));
        if (!servesCsp) {
          hits.push({
            file: CONFIG_FILE,
            reason:
              `the "${CATCH_ALL_SOURCE}" rule does not serve a ` +
              `Content-Security-Policy header`,
          });
        }
      }

      // 2-4. exact-value directives
      for (const [name, expected] of Object.entries(REQUIRED_EXACT)) {
        const value = directiveValue(parsed.directives, name);
        if (value === null) {
          hits.push({ file: CONFIG_FILE, reason: `CSP is missing the '${name}' directive` });
        } else if (value !== expected) {
          hits.push({
            file: CONFIG_FILE,
            reason: `CSP '${name}' must be exactly ${expected}, found: ${value}`,
          });
        }
      }

      // 5. connect-src must not be wide open
      const connectSrc = directiveValue(parsed.directives, "connect-src");
      if (connectSrc === null) {
        hits.push({ file: CONFIG_FILE, reason: "CSP is missing the 'connect-src' directive" });
      } else {
        if (/(^|\s)\*(\s|$)/.test(connectSrc)) {
          hits.push({
            file: CONFIG_FILE,
            reason: `CSP 'connect-src' contains a bare * wildcard: ${connectSrc}`,
          });
        }
        if (/(^|\s)https:(?!\/\/)/.test(connectSrc)) {
          hits.push({
            file: CONFIG_FILE,
            reason:
              `CSP 'connect-src' contains a bare \`https:\` scheme source, which ` +
              `permits exfiltration to any host: ${connectSrc}`,
          });
        }
      }

      // 6. 'unsafe-eval' only behind the dev branch
      for (const directive of parsed.directives) {
        if (!directive.raw.toLowerCase().includes("'unsafe-eval'")) continue;
        const guarded = /isDev\s*\?[^:]*'unsafe-eval'/.test(directive.raw);
        if (!guarded) {
          hits.push({
            file: CONFIG_FILE,
            reason:
              `'unsafe-eval' must appear only behind the \`isDev ? ... : ""\` ` +
              `branch, found unconditionally in: ${directive.text.slice(0, 90)}`,
          });
        }
      }

      // script-src must exist. 'unsafe-inline' there is deliberate, see header.
      if (directiveValue(parsed.directives, "script-src") === null) {
        hits.push({ file: CONFIG_FILE, reason: "CSP is missing the 'script-src' directive" });
      }
    }
  }

  // 7. build output
  let buildOutputPresent = false;
  for (const rel of BUILD_SCAN_DIRS) {
    const abs = join(root, rel);
    try {
      if (!(await stat(abs)).isDirectory()) continue;
    } catch {
      continue;
    }
    buildOutputPresent = true;
    await walkBuildOutput(abs, root, hits, counter);
  }

  const manifest = await readIfExists(join(root, ROUTES_MANIFEST));
  if (manifest !== null) {
    buildOutputPresent = true;
    counter.filesScanned += 1;
    if (!manifest.toLowerCase().includes(CSP_HEADER_NEEDLE)) {
      hits.push({
        file: toPosix(ROUTES_MANIFEST),
        reason:
          "compiled route manifest declares no Content-Security-Policy header, " +
          "the policy did not survive the build",
      });
    } else if (manifest.toLowerCase().includes("'unsafe-eval'")) {
      hits.push({
        file: toPosix(ROUTES_MANIFEST),
        reason: "compiled CSP contains 'unsafe-eval' in a production build",
      });
    }
  }

  return { hits, counter, buildOutputPresent };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** Mirrors the real next.config.ts shape closely enough to be a fair fixture. */
const GOOD_CONFIG = `
const isDev = process.env.NODE_ENV !== "production";
const STRIPE_SCRIPT = "https://js.stripe.com";
const STRIPE_CONNECT = "https://api.stripe.com https://r.stripe.com";
const CAPTCHA = "https://challenges.cloudflare.com";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  \`script-src 'self' 'unsafe-inline'\${isDev ? " 'unsafe-eval'" : ""} \${STRIPE_SCRIPT} \${CAPTCHA}\`,
  "style-src 'self' 'unsafe-inline'",
  \`connect-src 'self' \${STRIPE_CONNECT} \${CAPTCHA}\`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
`;

async function writeFixture(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

async function runSelfTest() {
  const base = join(tmpdir(), `check-csp-selftest-${process.pid}`);
  await rm(base, { recursive: true, force: true });

  const mutate = (from, to) => ({ "next.config.ts": GOOD_CONFIG.replace(from, to) });

  const cases = [
    {
      name: "compliant policy passes",
      expectFail: false,
      files: { "next.config.ts": GOOD_CONFIG },
    },
    {
      name: "script-src 'unsafe-inline' is ACCEPTED (deliberate, static header)",
      expectFail: false,
      files: { "next.config.ts": GOOD_CONFIG },
    },
    {
      name: "no CSP at all is caught",
      expectFail: true,
      files: { "next.config.ts": "export default { async headers() { return []; } };\n" },
    },
    {
      name: "default-src weakened is caught",
      expectFail: true,
      files: mutate(`"default-src 'self'"`, `"default-src *"`),
    },
    {
      name: "object-src weakened is caught",
      expectFail: true,
      files: mutate(`"object-src 'none'"`, `"object-src *"`),
    },
    {
      name: "base-uri removed is caught",
      expectFail: true,
      files: mutate(`  "base-uri 'none'",\n`, ""),
    },
    {
      name: "frame-ancestors weakened to 'self' is caught",
      expectFail: true,
      files: mutate(`"frame-ancestors 'none'"`, `"frame-ancestors 'self'"`),
    },
    {
      name: "form-action removed is caught",
      expectFail: true,
      files: mutate(`  "form-action 'self'",\n`, ""),
    },
    {
      name: "connect-src with a bare * is caught",
      expectFail: true,
      files: mutate(`connect-src 'self' \${STRIPE_CONNECT}`, `connect-src 'self' * \${STRIPE_CONNECT}`),
    },
    {
      name: "connect-src with a bare https: is caught",
      expectFail: true,
      files: mutate(`connect-src 'self' \${STRIPE_CONNECT}`, `connect-src 'self' https: \${STRIPE_CONNECT}`),
    },
    {
      name: "unconditional 'unsafe-eval' is caught",
      expectFail: true,
      files: mutate(`\${isDev ? " 'unsafe-eval'" : ""}`, ` 'unsafe-eval'`),
    },
    {
      name: "CSP not attached to the catch-all rule is caught",
      expectFail: true,
      files: mutate(`source: "/(.*)"`, `source: "/dashboard/:path*"`),
    },
    {
      name: "catch-all serving no CSP header is caught",
      expectFail: true,
      files: mutate(
        `  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },\n`,
        "",
      ),
    },
    {
      name: "'unsafe-eval' in BUILD OUTPUT is caught (proves .next/ is walked)",
      expectFail: true,
      files: {
        "next.config.ts": GOOD_CONFIG,
        ".next/server/app/page.js":
          'const h={"Content-Security-Policy":"script-src \'self\' \'unsafe-eval\'"};\n',
      },
    },
    {
      name: "routes-manifest with no CSP is caught",
      expectFail: true,
      files: {
        "next.config.ts": GOOD_CONFIG,
        ".next/routes-manifest.json": '{"version":3,"headers":[]}\n',
      },
    },
    {
      name: "routes-manifest carrying the CSP passes",
      expectFail: false,
      files: {
        "next.config.ts": GOOD_CONFIG,
        ".next/routes-manifest.json":
          '{"version":3,"headers":[{"source":"/(.*)","headers":[{"key":"Content-Security-Policy","value":"default-src \'self\'"}]}]}\n',
      },
    },
  ];

  let failures = 0;
  for (const [i, testCase] of cases.entries()) {
    const dir = join(base, `case-${i}`);
    await mkdir(dir, { recursive: true });
    await writeFixture(dir, testCase.files);

    const { hits } = await runScan(dir);
    const didFail = hits.length > 0;

    if (didFail === testCase.expectFail) {
      console.log(
        `  PASS  ${testCase.name}` + (didFail ? ` (guard reported: ${hits[0].reason})` : ""),
      );
    } else {
      failures += 1;
      console.error(
        `  FAIL  ${testCase.name}: expected the guard to ` +
          `${testCase.expectFail ? "REJECT" : "ACCEPT"} but it ` +
          `${didFail ? "rejected" : "accepted"}.`,
      );
      for (const hit of hits) console.error(`        ${hit.file}: ${hit.reason}`);
    }
  }

  await rm(base, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n[${SCRIPT_NAME}] --selftest FAILED (${failures} case(s)).`);
    process.exit(1);
  }
  console.log(`\n[${SCRIPT_NAME}] --selftest PASSED (${cases.length} cases).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  if (process.argv.slice(2).includes("--selftest")) {
    await runSelfTest();
    return;
  }

  const { hits, counter, buildOutputPresent } = await runScan(DASHBOARD_ROOT);

  if (hits.length === 0) {
    console.log(
      `[${SCRIPT_NAME}] OK, CSP declared in ${CONFIG_FILE} and served on ` +
        `"${CATCH_ALL_SOURCE}", ${counter.filesScanned} build file(s) scanned ` +
        `(${counter.cspBearingFiles} carried a CSP)` +
        (buildOutputPresent ? "" : ", build output absent so only source was checked"),
    );
    process.exit(0);
  }

  console.error(`[${SCRIPT_NAME}] FAIL, ${hits.length} CSP problem(s) detected.\n`);
  for (const hit of hits) console.error(`  ${hit.file}: ${hit.reason}`);
  console.error("");
  process.exit(1);
}

main().catch((err) => {
  console.error(`[${SCRIPT_NAME}] Unexpected error:`, err);
  process.exit(2);
});
