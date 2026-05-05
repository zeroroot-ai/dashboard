#!/usr/bin/env node
/**
 * Build guard: fail the build if anyone re-introduces direct LLM provider
 * credential reads or provider-SDK imports in the dashboard.
 *
 * Spec 25 (`daemon-driven-provider-config`) moves every LLM credential
 * into the daemon. The dashboard process must:
 *   - never read an LLM-provider API key from `process.env`
 *   - never import `@ai-sdk/<provider>` (Vercel adapters for specific
 *     providers — they would talk to upstream directly)
 *   - never import a vendor SDK directly (`@anthropic-ai/sdk`, bare
 *     `openai`, `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime`,
 *     `cohere-ai`, `@mistralai/mistralai`, `@google/genai`)
 *
 * The ONLY permitted packages are:
 *   - `@ai-sdk/provider` (types package, no network code)
 *   - `@ai-sdk/react` (client-side hook plumbing, no provider code)
 *   - `ai` (Vercel framework, no provider-specific network code)
 *
 * Any credential fetch goes through the daemon RPC layer (ExecuteLLM /
 * StreamLLM) via `src/lib/ai/gibson-llm-adapter.ts`.
 *
 * ## Scope
 * Scans `src/`, `app/`, `components/`, `lib/` recursively for files
 * matching `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`. Skips `node_modules/`,
 * `.next/`, `.turbo/`, `dist/`, `coverage/`, `.git/`, and this script
 * family itself (they legitimately contain the banned patterns in
 * regex literals).
 *
 * ## Comment-aware scanning
 * Lines that are entirely inside `//`-comments or C-style block
 * comments are skipped — regex literals that happen to live in JSDoc
 * (e.g. the adapter's own file header warning about these patterns)
 * are not violations.
 *
 * ## Escape valve
 * Add a literal line directly above the offending line:
 *   // eslint-disable-next-line gibson-no-llm-credential
 * The next non-blank, non-comment line is then skipped.
 *
 * Usage:
 *   node scripts/check-no-llm-credential-reads.mjs          # scan dashboard root
 *   node scripts/check-no-llm-credential-reads.mjs <path>   # scan a specific dir
 *   node scripts/check-no-llm-credential-reads.mjs -h       # print usage
 *
 * Exit codes: 0 = clean, 1 = at least one violation.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// --------------------------------------------------------------------------
// Argument parsing — only `-h`/`--help` and an optional root path.
// --------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  process.stdout.write(
    'check-no-llm-credential-reads — spec 25 static-analysis guard\n' +
      '\n' +
      'Usage:\n' +
      '  node scripts/check-no-llm-credential-reads.mjs [path]\n' +
      '\n' +
      'Scans the dashboard source tree for banned LLM-credential env-var\n' +
      'reads and direct provider-SDK imports. Exits 1 if any match.\n' +
      '\n' +
      'Escape valve: add `// eslint-disable-next-line gibson-no-llm-credential`\n' +
      'directly above a line to skip the check for the next non-blank line.\n',
  );
  process.exit(0);
}

const ROOT = resolve(argv[0] ?? new URL('..', import.meta.url).pathname);
const SCAN_DIRS = ['src', 'app', 'components', 'lib'];

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '.git',
]);

// The two guard scripts legitimately list the banned patterns in regex
// literals — excluding them prevents self-match. The test file for this
// script also stages synthetic violations inside regex literals during
// assertions, so it is excluded too.
const EXCLUDE_FILES = new Set([
  'scripts/check-no-llm-credential-reads.mjs',
  'scripts/check-no-provider-k8s-access.mjs',
  'scripts/check-no-llm-credential-reads.test.mjs',
  'scripts/check-no-provider-k8s-access.test.mjs',
]);

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs)$/;

const ESCAPE_DIRECTIVE = 'eslint-disable-next-line gibson-no-llm-credential';

// --------------------------------------------------------------------------
// Banned patterns
// --------------------------------------------------------------------------
const BANNED = [
  {
    name: 'process.env.<LLM_PROVIDER_CREDENTIAL>',
    // Explicit allow-list of known LLM-provider credential env var names.
    // Anchored on `API_KEY` / `API_TOKEN` / AWS_{ACCESS,SECRET}_* / the
    // small set of known-bad region-specific names so we don't misfire on
    // Auth.js / Zitadel OAuth2 client IDs (e.g. `GOOGLE_CLIENT_ID`) which
    // are unrelated to LLM credentials.
    regex:
      /process\.env\.(?:(?:ANTHROPIC|OPENAI|GOOGLE|GEMINI|COHERE|MISTRAL|HUGGINGFACE|CLOUDFLARE|XAI|GROQ|DEEPSEEK|DEEPINFRA|TOGETHER|FIREWORKS)_API_(?:KEY|TOKEN)|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_BEDROCK_[A-Z_]+|HUGGINGFACE_HUB_TOKEN|HF_TOKEN|GEMINI_KEY|OPENAI_[A-Z_]*(?:SECRET|KEY)|ANTHROPIC_[A-Z_]*(?:SECRET|KEY))/u,
    reason:
      'LLM-provider credentials must never be read from env in the dashboard. ' +
      'Credentials live in the daemon; proxy all calls through ExecuteLLM/StreamLLM.',
  },
  {
    name: '@ai-sdk/<provider> import',
    // Matches @ai-sdk/<specific-provider>. Does NOT match @ai-sdk/provider
    // (types) or @ai-sdk/react (client hooks) — those are allowed.
    regex:
      /@ai-sdk\/(?:anthropic|openai|google|amazon-bedrock|cohere|huggingface|mistral|openai-compatible|google-vertex|azure|xai|groq|deepseek|deepinfra|together|fireworks|vercel)\b/u,
    reason:
      'Dashboard must not import provider-specific Vercel AI SDK packages. ' +
      'Use src/lib/ai/gibson-llm-adapter.ts instead.',
  },
  {
    name: '@anthropic-ai/sdk import',
    regex: /['"]@anthropic-ai\/sdk['"]/u,
    reason: 'Direct Anthropic SDK import banned in dashboard.',
  },
  {
    name: 'bare `openai` import',
    // Match only `from 'openai'` / `from "openai"` / `require('openai')`
    // — do not match `@ai-sdk/openai-compatible` or path imports.
    regex: /(?:from|require\s*\()\s*['"]openai['"]/u,
    reason: 'Direct OpenAI SDK import banned in dashboard.',
  },
  {
    name: '@google/generative-ai import',
    regex: /['"]@google\/generative-ai['"]/u,
    reason: 'Direct Google Generative AI SDK import banned in dashboard.',
  },
  {
    name: '@google/genai import',
    regex: /['"]@google\/genai['"]/u,
    reason: 'Direct Google GenAI SDK import banned in dashboard.',
  },
  {
    name: '@aws-sdk/client-bedrock-runtime import',
    regex: /['"]@aws-sdk\/client-bedrock-runtime['"]/u,
    reason: 'Direct AWS Bedrock SDK import banned in dashboard.',
  },
  {
    name: 'cohere-ai import',
    regex: /['"]cohere-ai['"]/u,
    reason: 'Direct Cohere SDK import banned in dashboard.',
  },
  {
    name: '@mistralai/mistralai import',
    regex: /['"]@mistralai\/mistralai['"]/u,
    reason: 'Direct Mistral SDK import banned in dashboard.',
  },
];

// --------------------------------------------------------------------------
// File walker
// --------------------------------------------------------------------------
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    const rel = relative(ROOT, full);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      if (EXCLUDE_FILES.has(rel)) continue;
      if (!SOURCE_EXT.test(ent.name)) continue;
      out.push(full);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Comment-aware line classifier
//
// Produces, for each line, a flag indicating whether the line body is
// entirely inside a comment. Lines that mix code and comments are still
// scanned — the regex literal that lives in a JSDoc block is the case
// we genuinely need to skip (whole-line comment), not inline `// todo`
// tails on otherwise-code lines.
// --------------------------------------------------------------------------
function classifyLines(src) {
  const lines = src.split(/\r?\n/);
  const flags = new Array(lines.length).fill(false);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (inBlock) {
      flags[i] = true;
      if (trimmed.includes('*/')) {
        inBlock = false;
        // If there's code after the */ we'd like to still scan it.
        const after = trimmed.split('*/').slice(1).join('*/').trim();
        if (after.length > 0) flags[i] = false;
      }
      continue;
    }
    if (trimmed.startsWith('//')) {
      flags[i] = true;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      flags[i] = true;
      if (!trimmed.includes('*/') || trimmed.lastIndexOf('*/') < trimmed.indexOf('/*')) {
        inBlock = true;
      } else if (trimmed.endsWith('*/')) {
        // Single-line /* ... */ — still a pure-comment line.
      } else {
        // /* ... */ ... code — re-enable for code on tail.
        flags[i] = false;
      }
      continue;
    }
    // JSDoc continuation lines inside a block comment start with `*`.
    if (inBlock === false && trimmed.startsWith('*') && !trimmed.startsWith('**/')) {
      // Only treat as comment if the previous line was in a block.
      // Handled above via `inBlock`; fall through otherwise.
    }
  }
  return { lines, flags };
}

// --------------------------------------------------------------------------
// Per-file scan
// --------------------------------------------------------------------------
function scanFile(fullPath) {
  let body;
  try {
    body = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }
  const { lines, flags } = classifyLines(body);
  const violations = [];
  // Track lines to skip because previous line contained the escape directive.
  const skipNext = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(ESCAPE_DIRECTIVE)) {
      // Skip the next non-blank, non-comment line.
      for (let j = i + 1; j < lines.length; j++) {
        if (flags[j]) continue;
        if (lines[j].trim().length === 0) continue;
        skipNext[j] = true;
        break;
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (flags[i]) continue;
    if (skipNext[i]) continue;
    const line = lines[i];
    for (const rule of BANNED) {
      if (rule.regex.test(line)) {
        violations.push({
          file: fullPath,
          line: i + 1,
          rule: rule.name,
          reason: rule.reason,
          content: line.trim().slice(0, 160),
        });
      }
    }
  }
  return violations;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(join(ROOT, dir), files);
  }
  let violationCount = 0;
  for (const f of files) {
    const vs = scanFile(f);
    for (const v of vs) {
      const rel = relative(ROOT, v.file);
      process.stderr.write(
        `${rel}:${v.line}: ${v.rule} -> violation: ${v.reason}\n` +
          `    ${v.content}\n`,
      );
      violationCount++;
    }
  }
  if (violationCount > 0) {
    process.stderr.write(
      '\ncheck-no-llm-credential-reads: ' +
        `${violationCount} violation${violationCount === 1 ? '' : 's'} in ` +
        `${files.length} files scanned.\n` +
        'Dashboard must route every LLM call through the daemon (spec 25).\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    `check-no-llm-credential-reads: clean (${files.length} files scanned)\n`,
  );
  process.exit(0);
}

main();
