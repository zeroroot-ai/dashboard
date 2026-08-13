#!/usr/bin/env node
/**
 * stripe-webhook-reconcile.mjs — durable Stripe webhook-endpoint reconciler
 * (deploy#896).
 *
 * The root cause of deploy#896: the Stripe webhook endpoint and the signing
 * secret the receiver verifies against (`gibson/<env>/gibson-stripe-credentials`
 * property `webhook_secret`, ESO-synced into the `gibson-stripe-credentials`
 * K8s Secret) were two independently hand-maintained artefacts. Recreate the
 * endpoint, or reseed the secret, and every webhook delivery fails signature
 * verification until someone notices. This script makes ONE tool own both
 * halves in the same run, so they cannot drift.
 *
 * What it does (per run, per environment):
 *   1. Lists the account's webhook endpoints and selects those whose URL is
 *      exactly the target URL.
 *   2. Absent           -> creates the endpoint (Stripe returns the signing
 *                          secret ONLY at creation), then writes that secret
 *                          to the secret backend. This is the first-run
 *                          resync.
 *   3. Present          -> converges `enabled_events` (update in place).
 *                          Stripe never re-exposes an existing endpoint's
 *                          secret, so WITHOUT --rotate-secret the run cannot
 *                          prove endpoint<->backend coherence; it says so on
 *                          stdout and exits 0 (converged shape, unproven
 *                          secret).
 *   4. --rotate-secret  -> creates a fresh endpoint at the same URL, writes
 *                          its secret to the backend, then deletes every
 *                          other endpoint on that URL. If the backend write
 *                          fails, the fresh endpoint is deleted again and the
 *                          previous state is left untouched. Use this to
 *                          repair a suspected mismatch (deploy#896's staging
 *                          state) or after any hand-edit. Brief dual-delivery
 *                          during the swap is safe: the receiver is
 *                          idempotent (webhook_idempotency).
 *
 * Guard rails:
 *   - `--env staging` requires an `sk_test_` key; `--env prod` requires an
 *     `sk_live_` key AND the explicit `--allow-prod` flag (the prod path
 *     stays gated until the tool has reconciled staging cleanly at least
 *     once — deploy#896 owner decision). A mode/env mismatch exits 1 before
 *     any API call.
 *   - `--dry-run` performs reads only and prints the plan.
 *   - Secret values are never printed. Never add logging of the
 *     `secret` field (check-no-secret-in-logs).
 *
 * The secret backend write shells out to the `aws` CLI (the operator
 * tooling every deploy runbook already assumes) — no SDK dependency. It
 * merges the `webhook_secret` property into the existing JSON secret string
 * at `gibson/<env>/gibson-stripe-credentials`, preserving sibling
 * properties (secret_key, publishable_key, ...).
 *
 * Default `enabled_events` mirror the receiver's handled set — billing
 * `internal/webhook/sync.go` handles exactly the customer.subscription.*
 * lifecycle events and nothing else. Pass --events to override.
 *
 * Usage (ops session with Stripe + AWS credentials):
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-webhook-reconcile.mjs \
 *     --env staging --url https://app.staging.zeroroot.ai/api/billing/webhook \
 *     [--rotate-secret] [--dry-run] [--events a,b,c]
 *
 * Related: scripts/stripe-bootstrap.ts (portal configuration bootstrap —
 * webhook endpoints are owned HERE, not there).
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

/**
 * Events the billing webhook receiver actually handles
 * (billing internal/webhook/sync.go). Keep in sync with the receiver;
 * subscribing to events it ignores only adds retry noise.
 */
export const DEFAULT_ENABLED_EVENTS = Object.freeze([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

const MANAGED_BY = 'stripe-webhook-reconcile';

/** Compare two event lists as sets. */
export function sameEventSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const e of sa) if (!sb.has(e)) return false;
  return true;
}

/**
 * Validate the env/key-mode pairing (deploy#896 guard rail).
 * Throws Error on any violation; returns 'test' | 'live'.
 */
export function validateKeyForEnv({ env, key, allowProd }) {
  if (env !== 'staging' && env !== 'prod') {
    throw new Error(`--env must be staging or prod, got: ${env ?? '(unset)'}`);
  }
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  if (env === 'staging') {
    if (!key.startsWith('sk_test_')) {
      throw new Error('--env staging requires an sk_test_ key (staging runs Stripe test mode).');
    }
    return 'test';
  }
  if (!key.startsWith('sk_live_')) {
    throw new Error('--env prod requires an sk_live_ key.');
  }
  if (!allowProd) {
    throw new Error(
      '--env prod additionally requires --allow-prod. The prod path stays ' +
        'gated until the reconciler has converged staging cleanly at least ' +
        'once (deploy#896).',
    );
  }
  return 'live';
}

/**
 * Reconcile the webhook endpoint for one URL, and sync its signing secret
 * into the secret backend when it is knowable.
 *
 * @param {object} deps
 * @param {object} deps.stripe   object with webhookEndpoints.{list,create,update,del}
 * @param {object} deps.sink     object with writeWebhookSecret(secret) -> Promise
 * @param {string} deps.url      exact webhook endpoint URL
 * @param {string[]} deps.events desired enabled_events
 * @param {boolean} deps.rotateSecret
 * @param {boolean} deps.dryRun
 * @param {(msg: string) => void} [deps.log]
 * @returns {Promise<{action: string, endpointId: string|null, secretWritten: boolean}>}
 */
export async function reconcileWebhookEndpoint({
  stripe,
  sink,
  url,
  events,
  rotateSecret = false,
  dryRun = false,
  log = () => {},
}) {
  const listed = await stripe.webhookEndpoints.list({ limit: 100 });
  const matching = listed.data.filter((e) => e.url === url);

  const createParams = {
    url,
    enabled_events: [...events],
    description: `Gibson billing webhook (managed by ${MANAGED_BY})`,
    metadata: { managed_by: MANAGED_BY },
  };

  if (matching.length === 0) {
    if (dryRun) {
      log(`[dry-run] would CREATE endpoint for ${url} and write its signing secret to the backend`);
      return { action: 'would-create', endpointId: null, secretWritten: false };
    }
    const created = await stripe.webhookEndpoints.create(createParams);
    log(`created endpoint ${created.id} for ${url}`);
    await writeSecretOrRollback({ stripe, sink, created, log });
    return { action: 'created', endpointId: created.id, secretWritten: true };
  }

  if (rotateSecret) {
    if (dryRun) {
      log(
        `[dry-run] would ROTATE: create a fresh endpoint for ${url}, write its ` +
          `signing secret to the backend, then delete ${matching.length} existing ` +
          `endpoint(s): ${matching.map((e) => e.id).join(', ')}`,
      );
      return { action: 'would-rotate', endpointId: null, secretWritten: false };
    }
    const created = await stripe.webhookEndpoints.create(createParams);
    log(`created replacement endpoint ${created.id} for ${url}`);
    await writeSecretOrRollback({ stripe, sink, created, log });
    for (const old of matching) {
      await stripe.webhookEndpoints.del(old.id);
      log(`deleted superseded endpoint ${old.id}`);
    }
    return { action: 'rotated', endpointId: created.id, secretWritten: true };
  }

  // Converge shape in place. Prefer an enabled endpoint; newest first.
  const sorted = [...matching].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const target = sorted.find((e) => e.status === 'enabled') ?? sorted[0];
  const extras = sorted.filter((e) => e.id !== target.id);
  if (extras.length > 0) {
    log(
      `WARNING: ${extras.length} additional endpoint(s) on ${url} ` +
        `(${extras.map((e) => e.id).join(', ')}). Duplicate deliveries. ` +
        'Run with --rotate-secret to collapse them onto one endpoint.',
    );
  }

  let action = 'unchanged';
  if (!sameEventSet(target.enabled_events ?? [], events)) {
    if (dryRun) {
      log(`[dry-run] would UPDATE enabled_events on ${target.id}`);
      return { action: 'would-update', endpointId: target.id, secretWritten: false };
    }
    await stripe.webhookEndpoints.update(target.id, { enabled_events: [...events] });
    log(`updated enabled_events on ${target.id}`);
    action = 'updated';
  } else {
    log(`endpoint ${target.id} already matches the desired shape`);
  }
  log(
    "NOTE: Stripe never re-exposes an existing endpoint's signing secret, so " +
      'this run cannot prove the secret backend matches it. If deliveries ' +
      'fail signature verification, run again with --rotate-secret.',
  );
  return { action, endpointId: target.id, secretWritten: false };
}

/** Write the created endpoint's secret; on failure delete the endpoint again. */
async function writeSecretOrRollback({ stripe, sink, created, log }) {
  if (!created.secret) {
    await stripe.webhookEndpoints.del(created.id);
    throw new Error(
      `Stripe returned no signing secret for freshly created endpoint ${created.id}; ` +
        'rolled the endpoint back.',
    );
  }
  try {
    await sink.writeWebhookSecret(created.secret);
    log('signing secret written to the secret backend');
  } catch (err) {
    await stripe.webhookEndpoints.del(created.id);
    throw new Error(
      `secret backend write failed (${err instanceof Error ? err.message : String(err)}); ` +
        `rolled back endpoint ${created.id}. Previous endpoints were NOT touched.`,
    );
  }
}

/**
 * AWS Secrets Manager sink via the aws CLI. Merges `webhook_secret` into the
 * existing JSON secret string, preserving sibling properties.
 */
export function makeSecretsManagerSink({ env, execFile = execFileSync }) {
  const secretId = `gibson/${env}/gibson-stripe-credentials`;
  return {
    secretId,
    async writeWebhookSecret(secret) {
      const raw = execFile(
        'aws',
        [
          'secretsmanager', 'get-secret-value',
          '--secret-id', secretId,
          '--query', 'SecretString',
          '--output', 'text',
        ],
        { encoding: 'utf8' },
      );
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${secretId} SecretString is not JSON; refusing to overwrite it.`);
      }
      parsed.webhook_secret = secret;
      execFile(
        'aws',
        [
          'secretsmanager', 'put-secret-value',
          '--secret-id', secretId,
          '--secret-string', JSON.stringify(parsed),
        ],
        { encoding: 'utf8', stdio: ['ignore', 'ignore', 'inherit'] },
      );
    },
  };
}

function parseArgs(argv) {
  const args = { events: [...DEFAULT_ENABLED_EVENTS] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env') args.env = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--events') args.events = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--rotate-secret') args.rotateSecret = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.url || !/^https:\/\//.test(args.url)) {
    throw new Error('--url is required and must be https:// (the exact public webhook URL, e.g. https://app.<domain>/api/billing/webhook)');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = validateKeyForEnv({
    env: args.env,
    key: process.env.STRIPE_SECRET_KEY,
    allowProd: args.allowProd === true,
  });

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    appInfo: { name: MANAGED_BY },
  });
  const sink = makeSecretsManagerSink({ env: args.env });

  console.log(
    `[stripe-webhook-reconcile] env=${args.env} mode=${mode} url=${args.url} ` +
      `rotate=${args.rotateSecret === true} dry-run=${args.dryRun === true} ` +
      `backend=${sink.secretId}`,
  );

  const result = await reconcileWebhookEndpoint({
    stripe,
    sink,
    url: args.url,
    events: args.events,
    rotateSecret: args.rotateSecret === true,
    dryRun: args.dryRun === true,
    log: (m) => console.log(`[stripe-webhook-reconcile] ${m}`),
  });

  console.log(
    `[stripe-webhook-reconcile] done: action=${result.action} ` +
      `endpoint=${result.endpointId ?? '(none)'} secretWritten=${result.secretWritten}`,
  );
  if (result.secretWritten) {
    console.log(
      '[stripe-webhook-reconcile] ESO re-syncs the K8s Secret within its ' +
        'refreshInterval and Reloader rolls the receiver; allow ~2 minutes ' +
        'before judging deliveries.',
    );
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly && process.env.NODE_TEST_CONTEXT === undefined) {
  main().catch((err) => {
    console.error(`[stripe-webhook-reconcile] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
