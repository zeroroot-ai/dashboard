import { describe, expect, it } from 'vitest';

import { render as renderVerify } from '../templates/verify';
import { render as renderReset } from '../templates/reset';
import { render as renderClaim } from '../templates/claim';
import { render as renderAccountLocked } from '../templates/account-locked';
import { render as renderBillingRollback } from '../templates/billing-rollback';
import type { EmailMessage } from '../types';

/**
 * Deliverability guard — reject any template that references a remote
 * image (tracking pixel, logo served over HTTP(S), etc.).
 */
const REMOTE_IMG_RE = /<img[^>]+src=["']?https?:/i;

/**
 * Plain-text must be a COMPLETE message, not a stub. If a template
 * contains "see the HTML version" or similar it fails this check.
 */
const STUB_TEXT_RE = /see\s+(the\s+)?html\s+version|html\s+only/i;

function assertNoRemoteImages(html: string) {
  expect(html).not.toMatch(REMOTE_IMG_RE);
  // Also catch background-image: url("http(s)://…").
  expect(html).not.toMatch(/background(?:-image)?\s*:[^;]*url\(\s*['"]?https?:/i);
  // No obvious tracking pixels.
  expect(html).not.toMatch(/width=["']?1["']?\s+height=["']?1["']?/i);
}

function assertTextIsComplete(text: string, minLen = 100) {
  expect(text.length).toBeGreaterThanOrEqual(minLen);
  expect(text).not.toMatch(STUB_TEXT_RE);
}

function assertBasics(msg: EmailMessage) {
  expect(msg.to).toBeTruthy();
  expect(msg.subject).toBeTruthy();
  expect(msg.subject).not.toContain('\n');
  expect(msg.html).toContain('<html');
  assertNoRemoteImages(msg.html);
  assertTextIsComplete(msg.text);
}

describe('templates/verify', () => {
  const ctx = {
    email: 'alice@example.com',
    verificationUrl: 'https://dash.gibson.io/verify-email/confirm?token=abc',
    expiresInHours: 24,
  };
  const msg = renderVerify(ctx);

  it('produces a valid message', () => assertBasics(msg));
  it('routes to the user', () => expect(msg.to).toBe(ctx.email));
  it('embeds the verification URL in both html and text', () => {
    expect(msg.html).toContain(ctx.verificationUrl);
    expect(msg.text).toContain(ctx.verificationUrl);
  });
  it('mentions the expiry window', () => {
    expect(msg.text).toContain('24 hours');
    expect(msg.html).toContain('24 hours');
  });
  it('matches snapshot', () => expect(msg).toMatchSnapshot());
});

describe('templates/reset', () => {
  const ctx = {
    email: 'bob@example.com',
    resetUrl: 'https://dash.gibson.io/reset?token=xyz',
    expiresInHours: 1,
  };
  const msg = renderReset(ctx);

  it('produces a valid message', () => assertBasics(msg));
  it('pluralises the expiry window correctly (singular)', () => {
    expect(msg.text).toContain('1 hour');
    expect(msg.text).not.toContain('1 hours');
  });
  it('embeds the reset URL', () => {
    expect(msg.html).toContain(ctx.resetUrl);
    expect(msg.text).toContain(ctx.resetUrl);
  });
  it('matches snapshot', () => expect(msg).toMatchSnapshot());
});

describe('templates/claim', () => {
  const ctx = {
    email: 'carol@example.com',
    claimUrl: 'https://dash.gibson.io/claim?token=q',
    expiresInDays: 7,
    orgName: 'Acme R&D',
    role: 'admin',
    supportEmail: 'support@gibson.io',
  };
  const msg = renderClaim(ctx);

  it('produces a valid message', () => assertBasics(msg));
  it('HTML-escapes the org name (& → &amp;)', () => {
    expect(msg.html).toContain('Acme R&amp;D');
    expect(msg.html).not.toContain('Acme R&D<');
  });
  it('uses "an" before vowel-initial roles', () => {
    expect(msg.text).toMatch(/as an admin/);
  });
  it('uses "a" before consonant-initial roles', () => {
    const other = renderClaim({ ...ctx, role: 'member' });
    expect(other.text).toMatch(/as a member/);
  });
  it('matches snapshot', () => expect(msg).toMatchSnapshot());
});

describe('templates/account-locked', () => {
  const ctx = {
    email: 'dave@example.com',
    lockoutEndsAt: new Date('2026-04-17T12:00:00.000Z'),
    resetUrl: 'https://dash.gibson.io/reset?token=q',
  };
  const msg = renderAccountLocked(ctx);

  it('produces a valid message', () => assertBasics(msg));
  it('formats lockoutEndsAt as ISO 8601', () => {
    expect(msg.text).toContain('2026-04-17T12:00:00.000Z');
    expect(msg.html).toContain('2026-04-17T12:00:00.000Z');
  });
  it('accepts a pre-formatted string for lockoutEndsAt', () => {
    const s = renderAccountLocked({ ...ctx, lockoutEndsAt: '2099-01-01T00:00:00Z' });
    expect(s.text).toContain('2099-01-01T00:00:00Z');
  });
  it('matches snapshot', () => expect(msg).toMatchSnapshot());
});

describe('templates/billing-rollback', () => {
  const ctx = {
    email: 'erin@example.com',
    chargeAmount: 1999, // $19.99
    currency: 'usd',
    supportEmail: 'billing@gibson.io',
  };
  const msg = renderBillingRollback(ctx);

  it('produces a valid message', () => assertBasics(msg));
  it('formats the amount as major-units + ISO code', () => {
    expect(msg.text).toContain('19.99 USD');
    expect(msg.html).toContain('19.99 USD');
  });
  it('links the support email in the HTML', () => {
    expect(msg.html).toContain('mailto:billing@gibson.io');
  });
  it('matches snapshot', () => expect(msg).toMatchSnapshot());
});

describe('all templates — deliverability audit', () => {
  const renderers: Array<[string, () => EmailMessage]> = [
    [
      'verify',
      () =>
        renderVerify({
          email: 'a@example.com',
          verificationUrl: 'https://x/y',
          expiresInHours: 1,
        }),
    ],
    [
      'reset',
      () =>
        renderReset({
          email: 'a@example.com',
          resetUrl: 'https://x/y',
          expiresInHours: 2,
        }),
    ],
    [
      'claim',
      () =>
        renderClaim({
          email: 'a@example.com',
          claimUrl: 'https://x/y',
          expiresInDays: 3,
          orgName: 'o',
          role: 'r',
          supportEmail: 's@example.com',
        }),
    ],
    [
      'account-locked',
      () =>
        renderAccountLocked({
          email: 'a@example.com',
          lockoutEndsAt: new Date(0),
          resetUrl: 'https://x/y',
        }),
    ],
    [
      'billing-rollback',
      () =>
        renderBillingRollback({
          email: 'a@example.com',
          chargeAmount: 100,
          currency: 'USD',
          supportEmail: 's@example.com',
        }),
    ],
  ];

  for (const [name, r] of renderers) {
    it(`${name}: HTML has no <img src="http(s)…`, () => {
      const html = r().html;
      expect(html).not.toMatch(REMOTE_IMG_RE);
    });
    it(`${name}: plain-text body is complete`, () => {
      assertTextIsComplete(r().text);
    });
  }
});
