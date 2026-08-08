/**
 * The verified-signup cookie codec.
 *
 * The property under test is TAMPER-EVIDENCE. `httpOnly` keeps the cookie away
 * from script on the page; it says nothing about the person holding the
 * browser, who can put whatever they like in it. `tier` rides in this cookie
 * and the dashboard prices from it, so every field has to be unforgeable.
 *
 * Refs GHSA-r74f.
 */
import { describe, it, expect } from 'vitest';

import {
  encodeVerifiedSession,
  decodeVerifiedSession,
  displayOnly,
  type VerifiedSignupSession,
} from '../verified-session';

const SESSION: VerifiedSignupSession = {
  verifiedSessionToken: 'sess-token-1',
  attemptId: 'aaaaaaaa-0000-0000-0000-000000000001',
  email: 'owner@example.com',
  workspaceName: 'Example Workspace',
  tier: 'team',
};

/** Re-sign nothing: produce a payload with a syntactically valid but wrong sig. */
function forge(payload: object): string {
  return `${JSON.stringify(payload)}.${'0'.repeat(64)}`;
}

describe('verified-session codec', () => {
  it('round-trips a session', () => {
    expect(decodeVerifiedSession(encodeVerifiedSession(SESSION))).toEqual(SESSION);
  });

  it('round-trips the optional billing customer', () => {
    const withCustomer = { ...SESSION, stripeCustomerId: 'cus_123' };
    expect(decodeVerifiedSession(encodeVerifiedSession(withCustomer))).toEqual(withCustomer);
  });

  it('rejects an unsigned cookie, which is the old on-disk format', () => {
    expect(decodeVerifiedSession(JSON.stringify(SESSION))).toBeNull();
  });

  it('rejects a cookie whose signature does not match', () => {
    expect(decodeVerifiedSession(forge(SESSION))).toBeNull();
  });

  it('rejects a tier swapped for a cheaper one', () => {
    const cheaper = { ...SESSION, tier: 'starter' };
    expect(decodeVerifiedSession(forge(cheaper))).toBeNull();
  });

  it('rejects a tier edited inside an otherwise genuine cookie', () => {
    // Take a real signed cookie and rewrite one character of the payload. The
    // signature is still a real signature, just not of THIS payload.
    const genuine = encodeVerifiedSession(SESSION);
    const lastDot = genuine.lastIndexOf('.');
    const payload = genuine.slice(0, lastDot);
    const signature = genuine.slice(lastDot + 1);
    const tampered = payload.replace('"tier":"team"', '"tier":"starter"');

    expect(tampered).not.toBe(payload);
    expect(decodeVerifiedSession(`${tampered}.${signature}`)).toBeNull();
  });

  it('rejects a swapped billing customer', () => {
    expect(decodeVerifiedSession(forge({ ...SESSION, stripeCustomerId: 'cus_victim' }))).toBeNull();
  });

  it('rejects a signature lifted from a different session', () => {
    const other = encodeVerifiedSession({ ...SESSION, tier: 'starter' });
    const otherSig = other.slice(other.lastIndexOf('.') + 1);
    const mine = encodeVerifiedSession(SESSION);
    const minePayload = mine.slice(0, mine.lastIndexOf('.'));

    expect(decodeVerifiedSession(`${minePayload}.${otherSig}`)).toBeNull();
  });

  it('returns null for absent, empty and unsigned-looking values', () => {
    expect(decodeVerifiedSession(undefined)).toBeNull();
    expect(decodeVerifiedSession('')).toBeNull();
    expect(decodeVerifiedSession('no-dot-at-all')).toBeNull();
    expect(decodeVerifiedSession('.deadbeef')).toBeNull();
  });

  it('returns null when the payload is signed but not a session', () => {
    expect(decodeVerifiedSession(encodeVerifiedSession('nope' as never))).toBeNull();
    // Signed, well-formed JSON, but missing the capability.
    const noToken = { ...SESSION, verifiedSessionToken: '' };
    expect(decodeVerifiedSession(encodeVerifiedSession(noToken))).toBeNull();
  });

  it('survives a payload containing dots', () => {
    const dotted = { ...SESSION, workspaceName: 'a.b.c.d', email: 'first.last@example.com' };
    expect(decodeVerifiedSession(encodeVerifiedSession(dotted))).toEqual(dotted);
  });

  it('still strips the capability from the display projection', () => {
    const display = displayOnly(SESSION);
    expect(display).not.toHaveProperty('verifiedSessionToken');
    expect(display.tier).toBe('team');
  });
});
