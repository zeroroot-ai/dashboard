#!/usr/bin/env node
/**
 * check-no-emdash.mjs — customer-rendered copy must not contain em-dashes
 * (dashboard#752 / #753).
 *
 * Detection contract:
 *   - TSX/TS: comments are stripped first (line numbers preserved), so any
 *     surviving em-dash sits in a string literal, template literal, or JSX
 *     text — i.e. text that can reach the DOM. Those are violations.
 *     Code comments are immune by construction.
 *   - MDX: the whole file is prose shipped to customers; every em-dash is a
 *     violation.
 *   - Test files (*.test.*, *.spec.*, __tests__/) are skipped.
 *
 * Zero tolerance — there is NO allowlist file. Coverage grows by extending
 * SCOPED_ROOTS as sweep slices land (#753 landing → #754 app/components →
 * #755 content/docs).
 *
 * Usage:
 *   node scripts/check-no-emdash.mjs            # scan the scoped roots
 *   node scripts/check-no-emdash.mjs --selftest # verify the scanner
 *
 * Exit codes: 0 clean, 1 violations found (or selftest failure).
 */

import { readdir, readFile, stat, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

// Customer-facing rendered surfaces only (dashboard#752: guard enforces on
// customer-facing text). Internal src/lib, scripts, comments, and generated
// src/gen are swept once but not enforced here.
const SCOPED_ROOTS = [
  "app",
  "components",
  "src/components",
  "content/docs",
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".tmp", "test-results", "__tests__", "__snapshots__"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PROSE_EXT = new Set([".mdx", ".md"]);
const EMDASH = "—";

function isTestFile(path) {
  return /\.(test|spec)\.[a-z]+$/.test(path) || /__tests__/.test(path);
}

/**
 * Blank out block and line comments so developer prose never trips the
 * guard. Block stripping also neutralizes JSX comment containers `{/* ... *\/}`
 * (the `/* ... *\/` is blanked, leaving harmless braces). Newlines are
 * preserved so reported line numbers match the source. Same approach as
 * scripts/check-no-hardcoded-colors / check-no-light-mode.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/([^:]|^)\/\/.*$/gm, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** Return { line, excerpt } violations for one file's contents. */
export function scanContent(content, ext) {
  const violations = [];
  const text = PROSE_EXT.has(ext) ? content : stripComments(content);
  text.split("\n").forEach((line, i) => {
    if (line.includes(EMDASH)) {
      violations.push({ line: i + 1, excerpt: line.trim().slice(0, 100) });
    }
  });
  return violations;
}

async function* walk(path) {
  let s;
  try {
    s = await stat(path);
  } catch {
    return;
  }
  if (s.isFile()) {
    yield path;
    return;
  }
  if (!s.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(path, entry.name));
    } else {
      yield join(path, entry.name);
    }
  }
}

async function scanTree(roots = SCOPED_ROOTS, base = DASHBOARD_ROOT) {
  const found = [];
  for (const root of roots) {
    for await (const file of walk(join(base, root))) {
      const ext = extname(file);
      if (!CODE_EXT.has(ext) && !PROSE_EXT.has(ext)) continue;
      if (isTestFile(file)) continue;
      const content = await readFile(file, "utf8");
      for (const v of scanContent(content, ext)) {
        found.push({ file: relative(base, file), ...v });
      }
    }
  }
  return found;
}

async function selftest() {
  const dir = await mkdtemp(join(tmpdir(), "no-emdash-"));
  try {
    const cases = [
      // [name, relpath, content, expectViolation]
      ["jsx text node", "a/Hero.tsx", `export const X = () => <p>Agents run anywhere ${EMDASH} laptop or CI.</p>;\n`, true],
      ["string prop", "a/Alt.tsx", `export const X = () => <img alt={"dashboard ${EMDASH} mission control"} />;\n`, true],
      ["template literal", "a/Tpl.tsx", "export const t = `costs " + EMDASH + " per mission`;\n", true],
      ["mdx prose", "a/page.mdx", `Missions are CUE-typed ${EMDASH} validated at submit.\n`, true],
      ["block comment", "a/Cmt.tsx", `/* design note ${EMDASH} keep terse */\nexport const x = 1;\n`, false],
      ["line comment", "a/Line.tsx", `export const x = 1; // note ${EMDASH} internal\n`, false],
      ["jsx comment container", "a/JsxCmt.tsx", `export const X = () => <div>{/* opener ${EMDASH} promoted */}ok</div>;\n`, false],
      ["test file", "a/Hero.test.tsx", `it("x", () => expect("${EMDASH}").toBe("${EMDASH}"));\n`, false],
    ];
    let failed = 0;
    for (const [name, rel, content, expectViolation] of cases) {
      const p = join(dir, rel);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, content);
      const found = await scanTree(["a"], dir);
      const hit = found.some((v) => join(dir, v.file) === p);
      if (hit !== expectViolation) {
        console.error(`✗ selftest [${name}]: expected ${expectViolation ? "violation" : "clean"}, got ${hit ? "violation" : "clean"}`);
        failed++;
      }
      await rm(p);
    }
    if (failed) {
      console.error(`check-no-emdash selftest: ${failed} case(s) failed`);
      process.exit(1);
    }
    console.log(`✓ check-no-emdash selftest: ${cases.length} cases passed`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes("--selftest")) {
    await selftest();
    return;
  }
  const found = await scanTree();
  if (found.length) {
    console.error(`✗ check-no-emdash: ${found.length} em-dash(es) in customer-rendered copy:\n`);
    for (const v of found) {
      console.error(`  ${v.file}:${v.line}  ${v.excerpt}`);
    }
    console.error(
      "\nRewrite the sentence (comma, colon, period, or restructure) — do not " +
        "substitute an en-dash or double hyphen. Em-dashes are banned from " +
        "customer-rendered copy (dashboard#752).",
    );
    process.exit(1);
  }
  console.log(`✓ check-no-emdash: no em-dashes in customer-rendered copy (${SCOPED_ROOTS.join(", ")})`);
}

main().catch((err) => {
  console.error("check-no-emdash crashed:", err);
  process.exit(1);
});
