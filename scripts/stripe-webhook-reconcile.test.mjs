/**
 * Tests for stripe-webhook-reconcile.mjs (deploy#896).
 *
 * All Stripe and secret-backend interactions are injected fakes — no
 * network, no aws CLI, no real keys. Runs under `pnpm test:scripts`
 * (`node --test scripts/*.test.mjs`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ENABLED_EVENTS,
  makeSecretsManagerSink,
  reconcileWebhookEndpoint,
  sameEventSet,
  validateKeyForEnv,
} from './stripe-webhook-reconcile.mjs';

const URL = 'https://app.staging.example.test/api/billing/webhook';

function fakeStripe(initial = []) {
  let nextId = 1;
  const endpoints = [...initial];
  const calls = { create: [], update: [], del: [] };
  return {
    endpoints,
    calls,
    webhookEndpoints: {
      async list() {
        return { data: [...endpoints] };
      },
      async create(params) {
        const ep = {
          id: `we_new_${nextId}`,
          secret: `whsec_new_${nextId}`,
          status: 'enabled',
          created: 1000 + nextId,
          ...params,
        };
        nextId += 1;
        endpoints.push(ep);
        calls.create.push(params);
        return ep;
      },
      async update(id, params) {
        calls.update.push({ id, ...params });
        const ep = endpoints.find((e) => e.id === id);
        Object.assign(ep, params);
        return ep;
      },
      async del(id) {
        calls.del.push(id);
        const i = endpoints.findIndex((e) => e.id === id);
        if (i >= 0) endpoints.splice(i, 1);
        return { id, deleted: true };
      },
    },
  };
}

function fakeSink({ fail = false } = {}) {
  const writes = [];
  return {
    writes,
    async writeWebhookSecret(secret) {
      if (fail) throw new Error('backend unavailable');
      writes.push(secret);
    },
  };
}

// ---------------------------------------------------------------------------
// validateKeyForEnv — the env/mode/prod-gate guard rails
// ---------------------------------------------------------------------------

test('staging requires an sk_test_ key', () => {
  assert.equal(validateKeyForEnv({ env: 'staging', key: 'sk_test_x' }), 'test');
  assert.throws(() => validateKeyForEnv({ env: 'staging', key: 'sk_live_x' }), /sk_test_/);
  assert.throws(() => validateKeyForEnv({ env: 'staging', key: undefined }), /not set/);
});

test('prod requires sk_live_ AND the explicit --allow-prod gate', () => {
  assert.throws(() => validateKeyForEnv({ env: 'prod', key: 'sk_test_x', allowProd: true }), /sk_live_/);
  assert.throws(() => validateKeyForEnv({ env: 'prod', key: 'sk_live_x' }), /--allow-prod/);
  assert.equal(validateKeyForEnv({ env: 'prod', key: 'sk_live_x', allowProd: true }), 'live');
});

test('unknown env is rejected', () => {
  assert.throws(() => validateKeyForEnv({ env: 'dev', key: 'sk_test_x' }), /staging or prod/);
});

// ---------------------------------------------------------------------------
// reconcileWebhookEndpoint
// ---------------------------------------------------------------------------

test('absent endpoint: creates it and writes the signing secret', async () => {
  const stripe = fakeStripe();
  const sink = fakeSink();
  const res = await reconcileWebhookEndpoint({
    stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS],
  });
  assert.equal(res.action, 'created');
  assert.equal(res.secretWritten, true);
  assert.equal(stripe.calls.create.length, 1);
  assert.deepEqual(stripe.calls.create[0].enabled_events, [...DEFAULT_ENABLED_EVENTS]);
  assert.equal(sink.writes.length, 1);
  assert.match(sink.writes[0], /^whsec_/);
});

test('matching endpoint with matching events: no mutation, no secret write', async () => {
  const stripe = fakeStripe([
    { id: 'we_1', url: URL, enabled_events: [...DEFAULT_ENABLED_EVENTS], status: 'enabled', created: 1 },
  ]);
  const sink = fakeSink();
  const res = await reconcileWebhookEndpoint({
    stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS],
  });
  assert.equal(res.action, 'unchanged');
  assert.equal(res.endpointId, 'we_1');
  assert.equal(res.secretWritten, false);
  assert.equal(stripe.calls.create.length, 0);
  assert.equal(stripe.calls.update.length, 0);
  assert.equal(stripe.calls.del.length, 0);
  assert.equal(sink.writes.length, 0);
});

test('event drift converges via update in place', async () => {
  const stripe = fakeStripe([
    { id: 'we_1', url: URL, enabled_events: ['customer.subscription.created'], status: 'enabled', created: 1 },
  ]);
  const sink = fakeSink();
  const res = await reconcileWebhookEndpoint({
    stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS],
  });
  assert.equal(res.action, 'updated');
  assert.equal(stripe.calls.update.length, 1);
  assert.deepEqual(stripe.calls.update[0].enabled_events, [...DEFAULT_ENABLED_EVENTS]);
  assert.equal(sink.writes.length, 0, 'update cannot know the secret; must not write');
});

test('rotate: creates a replacement, writes its secret, deletes every old endpoint', async () => {
  const stripe = fakeStripe([
    { id: 'we_old1', url: URL, enabled_events: [], status: 'enabled', created: 1 },
    { id: 'we_old2', url: URL, enabled_events: [], status: 'disabled', created: 2 },
    { id: 'we_other', url: 'https://other.example.test/hook', enabled_events: [], status: 'enabled', created: 3 },
  ]);
  const sink = fakeSink();
  const res = await reconcileWebhookEndpoint({
    stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS], rotateSecret: true,
  });
  assert.equal(res.action, 'rotated');
  assert.equal(sink.writes.length, 1);
  assert.deepEqual(stripe.calls.del.sort(), ['we_old1', 'we_old2']);
  assert.ok(
    stripe.endpoints.find((e) => e.id === 'we_other'),
    'endpoints on other URLs must never be touched',
  );
});

test('rotate rolls back the new endpoint when the backend write fails', async () => {
  const stripe = fakeStripe([
    { id: 'we_old1', url: URL, enabled_events: [], status: 'enabled', created: 1 },
  ]);
  const sink = fakeSink({ fail: true });
  await assert.rejects(
    reconcileWebhookEndpoint({
      stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS], rotateSecret: true,
    }),
    /rolled back/,
  );
  assert.ok(stripe.endpoints.find((e) => e.id === 'we_old1'), 'old endpoint must survive');
  assert.equal(
    stripe.endpoints.filter((e) => e.url === URL).length, 1,
    'the failed replacement must be deleted again',
  );
});

test('dry-run mutates nothing in any branch', async () => {
  for (const initial of [
    [],
    [{ id: 'we_1', url: URL, enabled_events: [], status: 'enabled', created: 1 }],
  ]) {
    for (const rotateSecret of [false, true]) {
      const stripe = fakeStripe(initial.map((e) => ({ ...e })));
      const sink = fakeSink();
      const res = await reconcileWebhookEndpoint({
        stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS], rotateSecret, dryRun: true,
      });
      assert.match(res.action, /^(would-|unchanged)/);
      assert.equal(stripe.calls.create.length, 0);
      assert.equal(stripe.calls.update.length, 0);
      assert.equal(stripe.calls.del.length, 0);
      assert.equal(sink.writes.length, 0);
    }
  }
});

test('duplicate endpoints on the URL are warned about, not deleted, without rotate', async () => {
  const warnings = [];
  const stripe = fakeStripe([
    { id: 'we_1', url: URL, enabled_events: [...DEFAULT_ENABLED_EVENTS], status: 'enabled', created: 2 },
    { id: 'we_2', url: URL, enabled_events: [], status: 'disabled', created: 1 },
  ]);
  const sink = fakeSink();
  const res = await reconcileWebhookEndpoint({
    stripe, sink, url: URL, events: [...DEFAULT_ENABLED_EVENTS],
    log: (m) => warnings.push(m),
  });
  assert.equal(res.endpointId, 'we_1', 'must target the newest enabled endpoint');
  assert.equal(stripe.calls.del.length, 0);
  assert.ok(warnings.some((w) => w.includes('we_2')), 'duplicate must be named in a warning');
});

// ---------------------------------------------------------------------------
// makeSecretsManagerSink — merge semantics via a fake execFile
// ---------------------------------------------------------------------------

test('sink merges webhook_secret into the existing JSON, preserving siblings', async () => {
  const invocations = [];
  const existing = JSON.stringify({ secret_key: 'sk_test_abc', publishable_key: 'pk_test_abc' });
  const sink = makeSecretsManagerSink({
    env: 'staging',
    execFile: (cmd, args) => {
      invocations.push([cmd, ...args]);
      if (args.includes('get-secret-value')) return existing;
      return '';
    },
  });
  assert.equal(sink.secretId, 'gibson/staging/gibson-stripe-credentials');
  await sink.writeWebhookSecret('whsec_fresh');
  const put = invocations.find((i) => i.includes('put-secret-value'));
  assert.ok(put, 'must call put-secret-value');
  const body = JSON.parse(put[put.indexOf('--secret-string') + 1]);
  assert.equal(body.webhook_secret, 'whsec_fresh');
  assert.equal(body.secret_key, 'sk_test_abc');
  assert.equal(body.publishable_key, 'pk_test_abc');
});

test('sink refuses to overwrite a non-JSON SecretString', async () => {
  const sink = makeSecretsManagerSink({
    env: 'staging',
    execFile: (cmd, args) => (args.includes('get-secret-value') ? 'not-json' : ''),
  });
  await assert.rejects(sink.writeWebhookSecret('whsec_x'), /not JSON/);
});

// ---------------------------------------------------------------------------
// invariants
// ---------------------------------------------------------------------------

test('default events mirror the receiver handled set (billing internal/webhook/sync.go)', () => {
  assert.deepEqual([...DEFAULT_ENABLED_EVENTS], [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.paused',
    'customer.subscription.resumed',
  ]);
});

test('sameEventSet is order-insensitive and duplicate-safe', () => {
  assert.ok(sameEventSet(['a', 'b'], ['b', 'a']));
  assert.ok(!sameEventSet(['a'], ['a', 'b']));
  assert.ok(sameEventSet(['a', 'a', 'b'], ['b', 'a']));
});
