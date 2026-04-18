import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetEmailProviderForTests,
  getEmailProvider,
} from '../provider';
import { LogEmailProvider } from '../providers/log';
import { SmtpEmailProvider } from '../providers/smtp';
import { ResendEmailProvider } from '../providers/resend';
import type { EmailMessage } from '../types';

// --- SDK mocks ---------------------------------------------------------
//
// `nodemailer` and `resend` are declared peer deps loaded via dynamic
// `import()`. We mock them here so tests do not need the real SDKs
// installed and so we can assert on the exact payload shape.
//
// Each mock module exports BOTH a `default` and named bindings so that
// the provider's `default ?? namespace` fallback is also exercised.

const nodemailerSendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
const nodemailerCreateTransport = vi.fn().mockReturnValue({
  sendMail: nodemailerSendMail,
});

vi.mock('nodemailer', () => ({
  default: { createTransport: nodemailerCreateTransport },
  createTransport: nodemailerCreateTransport,
}));

const resendEmailsSend = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });

class FakeResend {
  public emails = { send: resendEmailsSend };
  public readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
}

vi.mock('resend', () => ({
  Resend: FakeResend,
  default: { Resend: FakeResend },
}));

// --- Shared fixtures ---------------------------------------------------

const ENV_KEYS = [
  'DASHBOARD_EMAIL_PROVIDER',
  'DASHBOARD_EMAIL_SMTP_HOST',
  'DASHBOARD_EMAIL_SMTP_PORT',
  'DASHBOARD_EMAIL_SMTP_USER',
  'DASHBOARD_EMAIL_SMTP_PASS',
  'DASHBOARD_EMAIL_SMTP_FROM',
  'DASHBOARD_EMAIL_RESEND_API_KEY',
  'DASHBOARD_EMAIL_RESEND_FROM',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetEmailProviderForTests();
  nodemailerCreateTransport.mockClear();
  nodemailerSendMail.mockClear();
  resendEmailsSend.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetEmailProviderForTests();
});

const msg: EmailMessage = {
  to: 'user@example.com',
  subject: 'Hi',
  html: '<p>Hello</p>',
  text: 'Hello',
  headers: { 'X-Test': '1' },
};

// --- Factory -----------------------------------------------------------

describe('getEmailProvider()', () => {
  it('defaults to the log provider when DASHBOARD_EMAIL_PROVIDER is unset', () => {
    const p = getEmailProvider();
    expect(p).toBeInstanceOf(LogEmailProvider);
  });

  it('returns the smtp provider when env=smtp and config is complete', () => {
    process.env.DASHBOARD_EMAIL_PROVIDER = 'smtp';
    process.env.DASHBOARD_EMAIL_SMTP_HOST = 'smtp.example.com';
    process.env.DASHBOARD_EMAIL_SMTP_PORT = '587';
    process.env.DASHBOARD_EMAIL_SMTP_USER = 'u';
    process.env.DASHBOARD_EMAIL_SMTP_PASS = 'p';
    process.env.DASHBOARD_EMAIL_SMTP_FROM = 'no-reply@example.com';

    const p = getEmailProvider();
    expect(p).toBeInstanceOf(SmtpEmailProvider);
  });

  it('returns the resend provider when env=resend and config is complete', () => {
    process.env.DASHBOARD_EMAIL_PROVIDER = 'resend';
    process.env.DASHBOARD_EMAIL_RESEND_API_KEY = 'rs_key';
    process.env.DASHBOARD_EMAIL_RESEND_FROM = 'no-reply@example.com';

    const p = getEmailProvider();
    expect(p).toBeInstanceOf(ResendEmailProvider);
  });

  it('throws on unknown provider values', () => {
    process.env.DASHBOARD_EMAIL_PROVIDER = 'carrier-pigeon';
    expect(() => getEmailProvider()).toThrow(/Unknown DASHBOARD_EMAIL_PROVIDER/);
  });

  it('caches the provider across calls until __resetEmailProviderForTests()', () => {
    const a = getEmailProvider();
    const b = getEmailProvider();
    expect(a).toBe(b);
    __resetEmailProviderForTests();
    const c = getEmailProvider();
    expect(c).not.toBe(a);
  });
});

// --- Log provider ------------------------------------------------------

describe('LogEmailProvider', () => {
  it('writes a JSON line with ONLY to+subject (no body / no headers)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = new LogEmailProvider();

    await p.send(msg);

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as string;
    expect(arg.startsWith('[email.log] ')).toBe(true);

    const json = JSON.parse(arg.slice('[email.log] '.length));
    expect(json).toEqual({ to: 'user@example.com', subject: 'Hi' });
    // Body MUST NOT be logged.
    expect(arg).not.toContain('Hello');
    expect(arg).not.toContain('X-Test');

    spy.mockRestore();
  });
});

// --- SMTP provider -----------------------------------------------------

describe('SmtpEmailProvider', () => {
  const setEnv = () => {
    process.env.DASHBOARD_EMAIL_SMTP_HOST = 'smtp.example.com';
    process.env.DASHBOARD_EMAIL_SMTP_PORT = '587';
    process.env.DASHBOARD_EMAIL_SMTP_USER = 'u';
    process.env.DASHBOARD_EMAIL_SMTP_PASS = 'p';
    process.env.DASHBOARD_EMAIL_SMTP_FROM = 'no-reply@example.com';
  };

  it('throws when required env is missing', () => {
    expect(() => new SmtpEmailProvider()).toThrow(/SMTP provider missing required env/);
  });

  it('rejects non-numeric ports', () => {
    setEnv();
    process.env.DASHBOARD_EMAIL_SMTP_PORT = 'banana';
    expect(() => new SmtpEmailProvider()).toThrow(/must be a valid port number/);
  });

  it('sends via nodemailer with the expected payload', async () => {
    setEnv();
    const p = new SmtpEmailProvider();
    await p.send(msg);

    expect(nodemailerCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });

    expect(nodemailerSendMail).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
      headers: { 'X-Test': '1' },
    });
  });

  it('flips `secure` to true when the port is 465', async () => {
    setEnv();
    process.env.DASHBOARD_EMAIL_SMTP_PORT = '465';
    const p = new SmtpEmailProvider();
    await p.send(msg);

    expect(nodemailerCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it('propagates transport errors (does not swallow)', async () => {
    setEnv();
    nodemailerSendMail.mockRejectedValueOnce(new Error('boom'));
    const p = new SmtpEmailProvider();
    await expect(p.send(msg)).rejects.toThrow('boom');
  });
});

// --- Resend provider ---------------------------------------------------

describe('ResendEmailProvider', () => {
  const setEnv = () => {
    process.env.DASHBOARD_EMAIL_RESEND_API_KEY = 'rs_key';
    process.env.DASHBOARD_EMAIL_RESEND_FROM = 'no-reply@example.com';
  };

  it('throws when required env is missing', () => {
    expect(() => new ResendEmailProvider()).toThrow(/Resend provider missing required env/);
  });

  it('sends via the Resend SDK with the expected payload', async () => {
    setEnv();
    const p = new ResendEmailProvider();
    await p.send(msg);

    expect(resendEmailsSend).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
      headers: { 'X-Test': '1' },
    });
  });

  it('throws when Resend returns an error object', async () => {
    setEnv();
    resendEmailsSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'bad from' },
    });
    const p = new ResendEmailProvider();
    await expect(p.send(msg)).rejects.toThrow(/Resend dispatch failed.*bad from/);
  });
});
