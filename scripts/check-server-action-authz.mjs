#!/usr/bin/env node
/**
 * Build guard: every server-action file (`"use server"`) that exports an
 * action must perform a server-side authorization check, or carry an explicit
 * exemption marker with a reason.
 *
 * Recognised authz patterns (any one satisfies the gate):
 *   - assertAuthorized(...)                      — DaemonAdminService RPC gating
 *   - requireCrdSession / requireCrdSessionForSelfAction  — CRD/k8s actions
 *   - getServerSession(...)                      — minimum floor: the action
 *       resolves the authenticated server session (and is expected to narrow
 *       to it / hasPermission). The two patterns above are preferred for
 *       mutations; this floor catches actions that proxy the daemon with no
 *       server-side identity at all.
 *
 * `app/actions/crd/**` is intentionally NOT covered here — it has its own,
 * stricter per-action gate in check-crd-action-authz.mjs.
 *
 * Exemption: place a marker anywhere in the file's top-of-file comment block:
 *   // @server-action-authz-exempt: <reason>
 * Reserve this for genuinely pre-auth or non-sensitive actions (e.g. signup
 * runs before a session exists; theme is a cosmetic preference). A reason is
 * mandatory and is meant to force a review-time conversation.
 *
 * Runs as part of `prebuild`. Fail-closed: a new server action with no
 * recognised gate and no exemption fails the build.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// Directories searched for server-action files.
const SEARCH_DIRS = [
  join(ROOT, "app", "actions"),
  join(ROOT, "src", "components"),
];

// crd/ is covered by check-crd-action-authz.mjs.
const EXCLUDE = [join(ROOT, "app", "actions", "crd")];

const AUTHZ_PATTERNS = [
  /\bassertAuthorized\s*\(/,
  /\brequireCrdSession(ForSelfAction)?\s*[<(]/,
];
// Recognised server-side session/tenant resolvers (the action derives identity
// from the authenticated session rather than from request input).
const SESSION =
  /\bgetServerSession\s*\(|\bgetActiveTenant\s*\(|\bawait\s+auth\s*\(/;

const EXEMPT = /@server-action-authz-exempt:\s*\S+/;
const USE_SERVER = /^\s*["']use server["']/m;
const EXPORTS_ACTION =
  /export\s+(async\s+function|const)\s+[a-zA-Z0-9_]+/;

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
    if (EXCLUDE.some((e) => full === e || full.startsWith(e + "/"))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out = out.concat(walk(full));
    } else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const dir of SEARCH_DIRS) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    if (!USE_SERVER.test(src)) continue;
    if (!EXPORTS_ACTION.test(src)) continue; // no exported action
    if (EXEMPT.test(src)) continue;

    const hasDirect = AUTHZ_PATTERNS.some((re) => re.test(src));
    const hasSession = SESSION.test(src);
    if (!hasDirect && !hasSession) {
      violations.push(file.replace(ROOT + "/", ""));
    }
  }
}

if (violations.length > 0) {
  console.error(
    "\ncheck-server-action-authz: server action(s) with no recognised " +
      "server-side authz check and no @server-action-authz-exempt marker:\n",
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nAdd assertAuthorized(...), requireCrdSession(...), or " +
      "getServerSession()+hasPermission(...), or — only for genuinely " +
      "pre-auth/non-sensitive actions — a\n  // @server-action-authz-exempt: <reason>\n" +
      "marker in the top-of-file comment block.\n",
  );
  process.exit(1);
}

console.log("check-server-action-authz: ok");
