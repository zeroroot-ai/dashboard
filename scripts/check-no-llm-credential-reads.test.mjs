#!/usr/bin/env node
/**
 * Tests for check-no-llm-credential-reads.mjs.
 *
 * Uses node:test (no vitest, because this script runs outside the
 * dashboard bundle and the vitest config only picks up *.test.ts under
 * src/, app/, components/). Drop a set of synthetic source files into a
 * tempdir, run the guard against that tempdir, and assert the exit code
 * plus stderr contents.
 *
 * Run: `node --test scripts/check-no-llm-credential-reads.test.mjs`
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const SCRIPT = resolve(
  new URL('.', import.meta.url).pathname,
  'check-no-llm-credential-reads.mjs',
);

function run(dir) {
  const res = spawnSync('node', [SCRIPT, dir], {
    encoding: 'utf8',
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    code: res.status ?? -1,
  };
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'check-llm-cred-'));
  for (const d of ['src', 'app', 'components', 'lib']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  return root;
}

test('clean tree exits 0', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'safe.ts'),
      "export const foo = process.env.NODE_ENV;\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /clean/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('process.env.ANTHROPIC_API_KEY triggers exit 1', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "const k = process.env.ANTHROPIC_API_KEY;\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /bad\.ts:1/);
    assert.match(r.stderr, /process\.env/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('process.env.GOOGLE_CLIENT_ID is allowed (OAuth, not LLM)', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'oauth.ts'),
      "const id = process.env.GOOGLE_CLIENT_ID;\n" +
        "const id2 = process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, `unexpected violation: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('@ai-sdk/anthropic import triggers', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "import { createAnthropic } from '@ai-sdk/anthropic';\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /@ai-sdk\/<provider> import/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('@ai-sdk/provider (types) is allowed', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'ok.ts'),
      "import type { LanguageModelV2 } from '@ai-sdk/provider';\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('@ai-sdk/react (hooks) is allowed', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'ok.ts'),
      "import { useChat } from '@ai-sdk/react';\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bare openai import triggers but openai-compatible does not', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "import OpenAI from 'openai';\n",
    );
    const bad = run(root);
    assert.equal(bad.code, 1);

    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "import { createOpenAICompatible } from '@ai-sdk/openai-compatible';\n",
    );
    const alsoBad = run(root);
    assert.equal(alsoBad.code, 1, 'openai-compatible is a banned @ai-sdk/ provider');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('@anthropic-ai/sdk import triggers', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "import Anthropic from '@anthropic-ai/sdk';\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /@anthropic-ai\/sdk/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('@aws-sdk/client-bedrock-runtime import triggers', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('comment describing a banned pattern is NOT a violation', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'doc.ts'),
      "/**\n" +
        " * This file must never import from '@ai-sdk/anthropic'.\n" +
        " */\n" +
        "export const noop = () => {};\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, `JSDoc should be ignored, got: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('// comment describing a banned pattern is NOT a violation', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'doc.ts'),
      "// Never reach for process.env.OPENAI_API_KEY here.\n" +
        "export const noop = () => {};\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('escape valve directive skips next line', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'escaped.ts'),
      "// eslint-disable-next-line gibson-no-llm-credential\n" +
        "const k = process.env.ANTHROPIC_API_KEY;\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, `escape valve should bypass, got: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('escape valve only skips ONE line', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'escaped.ts'),
      "// eslint-disable-next-line gibson-no-llm-credential\n" +
        "const k = process.env.ANTHROPIC_API_KEY;\n" +
        "const j = process.env.OPENAI_API_KEY;\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /OPENAI_API_KEY|escaped\.ts:3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('excludes node_modules / .next / .turbo / dist / coverage / .git', () => {
  const root = makeTempRoot();
  try {
    for (const d of ['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']) {
      mkdirSync(join(root, 'src', d), { recursive: true });
      writeFileSync(
        join(root, 'src', d, 'bad.ts'),
        "const k = process.env.ANTHROPIC_API_KEY;\n",
      );
    }
    const r = run(root);
    assert.equal(r.code, 0, `excluded dirs should be skipped, got: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scans .ts .tsx .js .jsx .mjs, ignores .md / .json', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.md'),
      "process.env.ANTHROPIC_API_KEY\n",
    );
    writeFileSync(
      join(root, 'src', 'bad.json'),
      '{"key":"process.env.ANTHROPIC_API_KEY"}\n',
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--help exits 0 and prints usage', () => {
  const res = spawnSync('node', [SCRIPT, '-h'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage:/);
  assert.match(res.stdout, /Escape valve/);
});
