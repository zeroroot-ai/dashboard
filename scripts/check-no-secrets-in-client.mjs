#!/usr/bin/env node
/**
 * Build guard: scan everything the browser can see for leaked server secrets.
 *
 * ## What went wrong before
 *
 * The previous revision exited 0 on both of its own trigger conditions:
 *
 *   - no secrets in `process.env`      -> "nothing to scan", exit 0
 *   - `.next/static` missing           -> "run after next build",  exit 0
 *   - `.next/static` has no .js files  -> "nothing to scan", exit 0
 *
 * The second and third are precisely the image-build condition the guard
 * exists to police: a build that produced no client output, or a guard invoked
 * where the output is not, silently passed. And because the value scan needs
 * the secret in the environment to have anything to search for, a CI job
 * without provider secrets configured ran a guard that could not fail.
 *
 * ## What this checks now
 *
 * Three independent scans, so the guard is never vacuous:
 *
 *   1. VALUE scan, opportunistic. For every secret actually present in the
 *      environment, search the client-visible output for its literal value.
 *      Runs only for secrets that are set, which is when it can matter.
 *   2. NAME scan, always runs. A client bundle that references
 *      `process.env.<SERVER_SECRET>` is a leak vector whether or not the value
 *      happened to be set at build time.
 *   3. SHAPE scan, always runs. Credential-shaped literals (Stripe live/test
 *      keys, PEM private keys, AWS access key ids, Slack tokens) in client
 *      output, regardless of whether the guard knows the variable name.
 *
 * Scans 2 and 3 need no secrets in the environment, so an unconfigured CI job
 * still runs a guard with teeth.
 *
 * ## Fail-closed inputs
 *
 * Missing build output is a FAILURE, not a skip. This script is wired into
 * `postbuild`; if it runs and there is no client output to inspect, either the
 * build did not produce one or the guard is running somewhere it cannot see
 * it. Both mean "unverified", and unverified is not "clean".
 *
 * ## Scan surface
 *
 * Everything the browser receives, not just `.next/static`:
 *   - `.next/static/**`            client JS/CSS chunks
 *   - `.next/server/**\/*.html`    prerendered HTML (can embed serialized props)
 *   - `.next/server/**\/*.rsc`     React flight payloads, shipped to the client
 *
 * A secret value is NEVER printed to stdout or stderr.
 *
 * ## Self-test
 *
 *   node scripts/check-no-secrets-in-client.mjs --selftest
 *
 * Exit codes: 0 clean, 1 violation or unverifiable inputs.
 */

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT_NAME = "check-no-secrets-in-client";
const ROOT = resolve(new URL("..", import.meta.url).pathname);

// ---------------------------------------------------------------------------
// What counts as a secret
// ---------------------------------------------------------------------------

/**
 * Explicitly named server-only secrets. Keep in sync with
 * src/lib/social-providers.ts and src/lib/env-validator.ts.
 */
const SECRET_ENV_VARS = [
  // OAuth / social providers
  "GITHUB_CLIENT_SECRET",
  "GITLAB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
  // Auth.js session HMAC
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  // IdP
  "ZITADEL_CLIENT_SECRET",
  "ZITADEL_DASHBOARD_CLIENT_SECRET",
  "ZITADEL_SERVICE_ACCOUNT_KEY",
  // Billing
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  // Backing stores
  "DATABASE_URL",
  "REDIS_URL",
  "NEO4J_PASSWORD",
  // Mail / cloud
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "RESEND_API_KEY",
  "SMTP_PASSWORD",
  // Platform
  "GIBSON_BOOTSTRAP_TOKEN",
  "TENANT_COOKIE_SECRET",
];

/**
 * Anything in the environment whose NAME looks like a credential is also
 * scanned, so a newly introduced secret is covered before anyone remembers to
 * add it to the list above. `NEXT_PUBLIC_*` is public by definition.
 */
const SECRET_NAME_PATTERN =
  /(SECRET|PASSWORD|PASSWD|PRIVATE_KEY|_TOKEN|TOKEN_|API_KEY|_KEY|CREDENTIALS)/;
const PUBLIC_NAME_PATTERN = /^(NEXT_PUBLIC_|PUBLIC_)/;

/** Values shorter than this are too collision-prone to grep for. */
const MIN_SECRET_LENGTH = 8;

/** Obvious non-secrets that match the name pattern. */
const NAME_ALLOWLIST = new Set([
  "npm_config_registry",
  "GITHUB_TOKEN_AUDIENCE",
]);

/** Credential-shaped literals that are never legitimate in client output. */
const SHAPE_PATTERNS = [
  { label: "Stripe live secret key", re: /sk_live_[A-Za-z0-9]{16,}/ },
  { label: "Stripe test secret key", re: /sk_test_[A-Za-z0-9]{16,}/ },
  { label: "Stripe restricted key", re: /rk_live_[A-Za-z0-9]{16,}/ },
  { label: "PEM private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Slack bot token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "GitHub personal access token", re: /\bghp_[A-Za-z0-9]{36}\b/ },
];

// ---------------------------------------------------------------------------
// Scan surface
// ---------------------------------------------------------------------------

/**
 * Each root the browser can see. `required: true` roots must exist and must
 * contain at least one scannable file, otherwise the run is unverifiable.
 */
const SCAN_ROOTS = [
  { rel: join(".next", "static"), exts: [".js", ".css"], required: true },
  { rel: join(".next", "server"), exts: [".html", ".rsc", ".body"], required: false },
];

function toPosix(p) {
  return p.split(sep).join("/");
}

function walk(dir, exts, out = []) {
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
      walk(full, exts, out);
    } else if (exts.some((ext) => name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Collect the secrets to search for from an environment object.
 */
function collectActiveSecrets(env) {
  const names = new Set(SECRET_ENV_VARS);
  for (const name of Object.keys(env)) {
    if (PUBLIC_NAME_PATTERN.test(name)) continue;
    if (NAME_ALLOWLIST.has(name)) continue;
    if (SECRET_NAME_PATTERN.test(name)) names.add(name);
  }
  const active = [];
  for (const name of names) {
    const value = env[name] ?? "";
    if (value.length >= MIN_SECRET_LENGTH) active.push({ name, value });
  }
  return { allNames: [...names], active };
}

/**
 * Run every scan against `root`. Returns violations plus the counters that
 * prove the scan was not vacuous.
 */
function runScan(root, env) {
  const violations = [];
  const { allNames, active } = collectActiveSecrets(env);

  const files = [];
  const perRoot = [];
  for (const scanRoot of SCAN_ROOTS) {
    const abs = join(root, scanRoot.rel);
    let exists = false;
    try {
      exists = statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    const found = exists ? walk(abs, scanRoot.exts) : [];
    perRoot.push({ ...scanRoot, exists, count: found.length });
    files.push(...found);

    if (scanRoot.required) {
      if (!exists) {
        violations.push({
          kind: "unverifiable",
          message:
            `${toPosix(scanRoot.rel)} does not exist. This guard runs as ` +
            `postbuild; with no client output there is nothing to verify, and ` +
            `"unverified" is not "clean". Run \`next build\` first, or run the ` +
            `guard where the build output is.`,
        });
      } else if (found.length === 0) {
        violations.push({
          kind: "unverifiable",
          message:
            `${toPosix(scanRoot.rel)} contains no ${scanRoot.exts.join("/")} ` +
            `files. A build that emitted no client bundle cannot be verified.`,
        });
      }
    }
  }

  for (const filePath of files) {
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const rel = toPosix(relative(root, filePath));

    // 1. VALUE scan
    for (const { name, value } of active) {
      if (content.includes(value)) {
        // NEVER print the value.
        violations.push({
          kind: "value",
          message:
            `${rel}: contains the literal value of ${name}. ` +
            `A server-only secret reached client-visible output.`,
        });
      }
    }

    // 2. NAME scan
    for (const name of allNames) {
      if (content.includes(`process.env.${name}`)) {
        violations.push({
          kind: "name",
          message:
            `${rel}: references process.env.${name}. Server-only env vars must ` +
            `not be referenced from client-visible code, the reference itself is ` +
            `the leak vector once the value is populated.`,
        });
      }
    }

    // 3. SHAPE scan
    for (const { label, re } of SHAPE_PATTERNS) {
      if (re.test(content)) {
        violations.push({
          kind: "shape",
          message: `${rel}: contains something shaped like a ${label}.`,
        });
      }
    }
  }

  return { violations, fileCount: files.length, activeCount: active.length, perRoot };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function writeFixture(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

const CLEAN_BUNDLE = {
  ".next/static/chunks/main.js": "export const x = 1; // nothing secret here\n",
};

function runSelfTest() {
  const base = join(tmpdir(), `${SCRIPT_NAME}-selftest-${process.pid}`);
  rmSync(base, { recursive: true, force: true });

  const SECRET = "s3cret-value-not-printed";

  const cases = [
    {
      name: "clean bundle with secrets in env passes",
      expectFail: false,
      files: CLEAN_BUNDLE,
      env: { AUTH_SECRET: SECRET },
    },
    {
      name: "clean bundle with NO secrets in env still passes (name+shape scans ran)",
      expectFail: false,
      files: CLEAN_BUNDLE,
      env: {},
    },
    {
      name: "MISSING build output is caught (was: silent exit 0)",
      expectFail: true,
      files: {},
      env: { AUTH_SECRET: SECRET },
    },
    {
      name: "build output with zero client bundles is caught (was: silent exit 0)",
      expectFail: true,
      files: { ".next/static/.keep": "" },
      env: { AUTH_SECRET: SECRET },
    },
    {
      name: "secret VALUE in a client chunk is caught",
      expectFail: true,
      files: { ".next/static/chunks/main.js": `const a="${SECRET}";\n` },
      env: { AUTH_SECRET: SECRET },
    },
    {
      name: "secret VALUE in prerendered HTML is caught (widened surface)",
      expectFail: true,
      files: {
        ...CLEAN_BUNDLE,
        ".next/server/app/index.html": `<script>window.__D={"k":"${SECRET}"}</script>`,
      },
      env: { AUTH_SECRET: SECRET },
    },
    {
      name: "secret VALUE in an RSC flight payload is caught (widened surface)",
      expectFail: true,
      files: { ...CLEAN_BUNDLE, ".next/server/app/page.rsc": `2:["${SECRET}"]\n` },
      env: { AUTH_SECRET: SECRET },
    },
    {
      name: "process.env.<SECRET> reference is caught with NO secret in env",
      expectFail: true,
      files: { ".next/static/chunks/main.js": "const a=process.env.AUTH_SECRET;\n" },
      env: {},
    },
    {
      name: "credential-SHAPED literal is caught with NO secret in env",
      expectFail: true,
      files: {
        ".next/static/chunks/main.js":
          'const k="sk_live_ABCDEF0123456789abcdef";\n',
      },
      env: {},
    },
    {
      name: "newly introduced *_SECRET env var is covered without a list edit",
      expectFail: true,
      files: { ".next/static/chunks/main.js": `const a="${SECRET}";\n` },
      env: { SOME_BRAND_NEW_SECRET: SECRET },
    },
  ];

  let failures = 0;
  for (const [i, testCase] of cases.entries()) {
    const dir = join(base, `case-${i}`);
    mkdirSync(dir, { recursive: true });
    writeFixture(dir, testCase.files);

    const { violations } = runScan(dir, testCase.env);
    const didFail = violations.length > 0;

    if (didFail === testCase.expectFail) {
      console.log(
        `  PASS  ${testCase.name}` +
          (didFail ? ` (guard reported: ${violations[0].kind})` : ""),
      );
    } else {
      failures += 1;
      console.error(
        `  FAIL  ${testCase.name}: expected the guard to ` +
          `${testCase.expectFail ? "REJECT" : "ACCEPT"} but it ` +
          `${didFail ? "rejected" : "accepted"}.`,
      );
      for (const v of violations) console.error(`        ${v.message}`);
    }
  }

  rmSync(base, { recursive: true, force: true });

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

if (process.argv.slice(2).includes("--selftest")) {
  runSelfTest();
} else {
  const { violations, fileCount, activeCount, perRoot } = runScan(ROOT, process.env);

  if (violations.length > 0) {
    console.error(`\n${SCRIPT_NAME}: FAIL, ${violations.length} problem(s).\n`);
    for (const v of violations) console.error(`  - [${v.kind}] ${v.message}`);
    console.error(
      "\nServer-only values must never reach client-visible output.\n" +
        "Common causes:\n" +
        "  1. A server module that reads the secret is imported by a client component.\n" +
        "  2. The secret was passed as a prop from a server to a client component.\n" +
        "  3. A build plugin or custom webpack config inadvertently included it.\n" +
        "Consult the Next.js docs on server-only modules and the `server-only` package.\n",
    );
    process.exit(1);
  }

  const surface = perRoot
    .map((r) => `${toPosix(r.rel)}=${r.exists ? r.count : "absent"}`)
    .join(", ");
  console.log(
    `${SCRIPT_NAME}: ok, ${fileCount} client-visible file(s) scanned ` +
      `[${surface}], ${activeCount} secret value(s) searched for, ` +
      `plus name and shape scans.`,
  );
}
