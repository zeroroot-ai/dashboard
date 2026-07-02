#!/usr/bin/env node
/**
 * Tests for check-no-provider-k8s-access.mjs. See sibling
 * check-no-llm-credential-reads.test.mjs for the general test pattern.
 *
 * Run: `node --test scripts/check-no-provider-k8s-access.test.mjs`
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
  'check-no-provider-k8s-access.mjs',
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
  const root = mkdtempSync(join(tmpdir(), 'check-prov-k8s-'));
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
      "export const name = 'langfuse-secret';\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /clean/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('`llm-providers` string literal triggers exit 1', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "const SECRET_NAME = 'llm-providers';\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /`llm-providers` Secret reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider-storage path reference triggers', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "import { readProviders } from '@/src/lib/k8s/provider-storage';\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /provider-storage/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readNamespacedSecret with llm-provider triggers', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.ts'),
      "await client.readNamespacedSecret({ name: 'llm-providers', namespace: ns });\n",
    );
    const r = run(root);
    assert.equal(r.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readNamespacedSecret for OTHER secrets is allowed', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'ok.ts'),
      "await client.readNamespacedSecret({ name: 'spire-bundle', namespace: ns });\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('JSDoc comment describing banned pattern is NOT a violation', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'doc.ts'),
      "/**\n" +
        " * Historical note: the legacy `llm-providers` Secret is removed.\n" +
        " */\n" +
        "export const noop = () => {};\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('// comment describing banned pattern is NOT a violation', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'doc.ts'),
      "// Do not reintroduce `llm-providers`; use daemon RPC.\n" +
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
        "const NAME = 'llm-providers';\n",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('excludes node_modules and build dirs', () => {
  const root = makeTempRoot();
  try {
    for (const d of ['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']) {
      mkdirSync(join(root, 'src', d), { recursive: true });
      writeFileSync(
        join(root, 'src', d, 'bad.ts'),
        "const NAME = 'llm-providers';\n",
      );
    }
    const r = run(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only scans .ts/.tsx/.js/.jsx/.mjs files', () => {
  const root = makeTempRoot();
  try {
    writeFileSync(
      join(root, 'src', 'bad.md'),
      "The old secret was `llm-providers`.\n",
    );
    writeFileSync(
      join(root, 'src', 'bad.yaml'),
      "name: llm-providers\n",
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
