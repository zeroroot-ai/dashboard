-- Migration: 0042_webhook_idempotency.sql
-- Replaces the inline CREATE TABLE IF NOT EXISTS in route.ts with a
-- proper schema-managed table with retention control and observability columns.
--
-- This migration is idempotent: safe to run multiple times.
-- All statements use IF NOT EXISTS / CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS webhook_idempotency (
    event_id        TEXT        NOT NULL,
    -- Stripe event type for observability queries (not used in idempotency logic).
    event_type      TEXT        NOT NULL DEFAULT '',
    -- Tenant this event was attributed to (may be empty for pre-tenant events).
    tenant_id       TEXT        NOT NULL DEFAULT '',
    -- Outcome: 'processed' | 'error' | 'duplicate'
    outcome         TEXT        NOT NULL DEFAULT 'processed',
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Retention: 90 days default (covers Stripe's ~3-day retry window with
    -- large margin; 7-day minimum per NFR-R1; 90 days aligns with Stripe's
    -- own reasonable replay window guidance).
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
    CONSTRAINT webhook_idempotency_pkey PRIMARY KEY (event_id)
);

-- Index for retention sweeps (batch DELETE WHERE expires_at < NOW()).
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_expires_at
    ON webhook_idempotency (expires_at);

-- Index for tenant-scoped audit queries (admin billing view, R9.3).
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_tenant_id
    ON webhook_idempotency (tenant_id)
    WHERE tenant_id != '';

-- Backward-compatibility view so any code still referencing gibson_stripe_events
-- continues to work during the transition window.
CREATE OR REPLACE VIEW gibson_stripe_events AS
    SELECT event_id, received_at
    FROM webhook_idempotency;

-- Retention sweep: run nightly via pg_cron or a CronJob.
-- DELETE FROM webhook_idempotency WHERE expires_at < NOW();
