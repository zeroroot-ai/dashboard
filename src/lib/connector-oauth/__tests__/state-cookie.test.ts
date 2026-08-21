/**
 * The flow cookie is the callback's entire basis for trust: it decides which
 * connector a grant lands on and which token endpoint the platform will call
 * for the life of that grant. These tests pin the tamper-evidence.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  sealConnectorOAuthSession,
  openConnectorOAuthSession,
  newCodeVerifier,
  newState,
  codeChallengeS256,
  type ConnectorOAuthSession,
} from '../state-cookie';

function sampleSession(): ConnectorOAuthSession {
  return {
    state: newState(),
    codeVerifier: newCodeVerifier(),
    installId: 'install-1',
    connector: 'connector-gitlab',
    tokenEndpoint: 'https://gitlab.example.com/oauth/token',
    revocationEndpoint: 'https://gitlab.example.com/oauth/revoke',
    clientId: 'client-abc',
    scope: 'mcp',
    redirectUri: 'https://app.example.com/dashboard/connectors/oauth/callback',
  };
}

describe('connector oauth state cookie', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'unit-test-signing-secret-0123456789';
  });

  it('round-trips a sealed session', () => {
    const session = sampleSession();
    const opened = openConnectorOAuthSession(sealConnectorOAuthSession(session));
    expect(opened).toEqual(session);
  });

  it('treats a tampered payload as absent', () => {
    const sealed = sealConnectorOAuthSession(sampleSession());
    const [payload, sig] = [sealed.slice(0, sealed.lastIndexOf('.')), sealed.slice(sealed.lastIndexOf('.') + 1)];
    // Rewrite the connector inside the payload; keep the original signature.
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    parsed.connector = 'connector-attacker';
    const forged = `${Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')}.${sig}`;
    expect(openConnectorOAuthSession(forged)).toBeNull();
  });

  it('treats a truncated or absent cookie as absent', () => {
    expect(openConnectorOAuthSession(undefined)).toBeNull();
    expect(openConnectorOAuthSession('')).toBeNull();
    expect(openConnectorOAuthSession('no-dot-here')).toBeNull();
    expect(openConnectorOAuthSession('payload.deadbeef')).toBeNull();
  });

  it('rejects a verified payload missing required fields', () => {
    const incomplete = { ...sampleSession(), codeVerifier: '' };
    expect(
      openConnectorOAuthSession(sealConnectorOAuthSession(incomplete)),
    ).toBeNull();
  });

  it('computes the RFC 7636 appendix B challenge', () => {
    // The worked example from RFC 7636 §B.
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('mints high-entropy verifiers in the unreserved alphabet', () => {
    const v = newCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(newCodeVerifier()).not.toBe(v);
  });
});
