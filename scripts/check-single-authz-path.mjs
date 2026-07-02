/**
 * Build guard: lock the single authorization path.
 *
 * Authorization in the dashboard has exactly ONE source of truth, the
 * generated AuthRegistry relation model:
 *   - client gates → useAuthorize(rpcMethod)
 *   - server gates → assertAuthorized(rpcMethod) / requireCrdSession(action)
 *   - relation tiers → satisfiesRelation / rolesAreCrossTenant
 *
 * The legacy parallel system, the sync usePermitted hook, the static
 * permission closure (ADMIN_PERMISSIONS / session.user.permissions /
 * hasPermission), and the dead GetAuthSchema cache (loadSchema /
 * resolveEffectivePermissions / resolveCrossTenant), was deleted because it
 * drifted from the daemon and silently denied. This guard fails the build if
 * any of it is reintroduced, and if any useAuthorize/assertAuthorized call
 * references a method that is not in the AuthRegistry (a fail-closed typo).
 *
 * Sibling of check-server-action-authz.mjs / check-crd-action-authz.mjs and
 * the useAuthorize-vs-usePermitted-shape ast-check (which it complements, not
 * duplicates: that one checks call SHAPE; this one bans the legacy system and
 * verifies method names resolve).
 *
 * Run:    node scripts/check-single-authz-path.mjs
 * Selftest: node scripts/check-single-authz-path.mjs --selftest
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const SEARCH_DIRS = [join(ROOT, "app"), join(ROOT, "components"), join(ROOT, "src")];

// Generated code + the guard fixtures (which legitimately contain the banned
// tokens as test inputs) are not product code.
const EXCLUDE_DIRS = [
  join(ROOT, "src", "gen"),
  join(ROOT, "node_modules"),
  join(ROOT, "scripts"),
];

// Banned tokens, the deleted legacy authorization system. Each maps to a hint.
const BANNED = [
  { re: /\busePermitted\b/, hint: "usePermitted was removed, gate UI on useAuthorize(rpcMethod)." },
  { re: /\bhasPermission\b/, hint: "hasPermission was removed, use assertAuthorized / requireCrdSession." },
  { re: /\bresolveEffectivePermissions\b/, hint: "the static permission closure was removed." },
  { re: /\bresolveCrossTenant\b/, hint: "crossTenant is derived from the role (rolesAreCrossTenant)." },
  { re: /\bderivePermissionsFromRoles\b/, hint: "the static permission closure was removed." },
  { re: /\bADMIN_PERMISSIONS\b/, hint: "the static permission map was removed." },
  { re: /\bloadSchema\b/, hint: "the GetAuthSchema cache was removed." },
  { re: /\.user\.permissions\b/, hint: "session.user.permissions was removed, authorization is relation-based." },
];

const AUTHZ_CALL = /\b(?:useAuthorize|assertAuthorized)\s*\(\s*["'`]([^"'`]+)["'`]/g;

/**
 * Load the set of valid RPC method keys from the generated AuthRegistry.
 */
export function loadRegistryMethods(registrySrc) {
  const methods = new Set();
  const re = /["'](\/gibson\.[^"']+)["']\s*:/g;
  let m;
  while ((m = re.exec(registrySrc)) !== null) methods.add(m[1]);
  return methods;
}

/**
 * Blank out line and block comments (including JSDoc), replacing comment
 * characters with spaces so line numbers and offsets are preserved. This keeps
 * the guard from flagging the doc comments that explain the deletion, or the
 * example snippets that use placeholder method names.
 */
export function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}

/**
 * Pure scanner: returns an array of violation strings for one file's contents.
 * `registryMethods` is the Set from loadRegistryMethods.
 */
export function findViolations(path, src, registryMethods) {
  const out = [];
  const code = stripComments(src);
  code.split("\n").forEach((line, i) => {
    for (const { re, hint } of BANNED) {
      if (re.test(line)) out.push(`${path}:${i + 1}, ${hint}`);
    }
  });
  // Method-name resolution for authz calls with string literals (code only).
  let m;
  AUTHZ_CALL.lastIndex = 0;
  while ((m = AUTHZ_CALL.exec(code)) !== null) {
    const method = m[1];
    if (!registryMethods.has(method)) {
      out.push(
        `${path}, useAuthorize/assertAuthorized references "${method}", which is not in the AuthRegistry (fail-closed typo).`,
      );
    }
  }
  return out;
}

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (EXCLUDE_DIRS.some((e) => full === e || full.startsWith(e + "/"))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      out = out.concat(walk(full));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function selftest() {
  const methods = new Set(["/gibson.tenant.v1.MembershipService/SetComponentAccess"]);
  const cases = [
    { name: "usePermitted", src: `const ok = usePermitted("components:manage");`, expect: true },
    { name: "hasPermission", src: `if (hasPermission(s, "x")) {}`, expect: true },
    { name: "session.user.permissions", src: `const p = session.user.permissions;`, expect: true },
    { name: "ADMIN_PERMISSIONS", src: `import { ADMIN_PERMISSIONS } from "x";`, expect: true },
    { name: "unknown authz method", src: `useAuthorize("/gibson.foo/Bar");`, expect: true },
    { name: "comment mentioning usePermitted is OK", src: `// usePermitted was removed`, expect: false },
    { name: "valid useAuthorize", src: `useAuthorize("/gibson.tenant.v1.MembershipService/SetComponentAccess");`, expect: false },
  ];
  let failed = false;
  for (const c of cases) {
    const got = findViolations("synthetic.ts", c.src, methods).length > 0;
    if (got !== c.expect) {
      console.error(`  selftest FAIL [${c.name}]: expected violation=${c.expect}, got ${got}`);
      failed = true;
    }
  }
  if (failed) {
    console.error("check-single-authz-path --selftest: FAILED");
    process.exit(1);
  }
  console.log("check-single-authz-path --selftest: ok");
}

function main() {
  if (process.argv.includes("--selftest")) {
    selftest();
    return;
  }
  let registryMethods;
  try {
    registryMethods = loadRegistryMethods(
      readFileSync(join(ROOT, "src", "gen", "authz", "registry.ts"), "utf8"),
    );
  } catch {
    console.error("check-single-authz-path: could not read src/gen/authz/registry.ts");
    process.exit(1);
  }
  const violations = [];
  for (const dir of SEARCH_DIRS) {
    for (const file of walk(dir)) {
      const rel = file.slice(ROOT.length + 1);
      violations.push(...findViolations(rel, readFileSync(file, "utf8"), registryMethods));
    }
  }
  if (violations.length > 0) {
    console.error("check-single-authz-path: FAIL, the single authorization path was violated:\n");
    for (const v of violations) console.error("  " + v);
    console.error(
      "\nAuthorization is relation-based via the AuthRegistry (useAuthorize / assertAuthorized / requireCrdSession). The legacy permission system was deleted; do not reintroduce it.",
    );
    process.exit(1);
  }
  console.log("check-single-authz-path: ok");
}

main();
