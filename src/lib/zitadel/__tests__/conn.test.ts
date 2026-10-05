// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The connection contract of ADR-0092 (dashboard#88): server-side identity
 * calls go to the in-cluster Service with the instance header, and a call to
 * any other origin is refused.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INSTANCE_HOST_HEADER,
  ZitadelConnError,
  newZitadelEndpoint,
  zitadelEndpoint,
  zitadelFetch,
} from '../conn';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    ZITADEL_URL: 'http://gibson-zitadel:8080',
    ZITADEL_EXTERNAL_DOMAIN: 'app.example.test',
    ZITADEL_ISSUER: 'https://app.example.test',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

function captureFetch() {
  const calls: { url: string; headers: Headers }[] = [];
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      headers: new Headers(init?.headers),
    });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

describe('newZitadelEndpoint', () => {
  it('builds the fixed paths on the connect base', () => {
    const e = newZitadelEndpoint('http://gibson-zitadel:8080/', 'app.example.test');
    expect(e.baseUrl).toBe('http://gibson-zitadel:8080');
    expect(e.host).toBe('app.example.test');
    expect(e.tokenUrl).toBe('http://gibson-zitadel:8080/oauth/v2/token');
    expect(e.jwksUrl).toBe('http://gibson-zitadel:8080/oauth/v2/keys');
    expect(e.userinfoUrl).toBe('http://gibson-zitadel:8080/oidc/v1/userinfo');
  });

  it.each([
    ['a relative URL', 'gibson-zitadel:8080/x y', /not an absolute URL|must be http or https/],
    ['another scheme', 'ftp://gibson-zitadel', /must be http or https/],
    ['a path', 'http://gibson-zitadel:8080/oauth', /no path, query or fragment/],
    ['a query', 'http://gibson-zitadel:8080/?x=1', /no path, query or fragment/],
  ])('refuses a connect URL with %s', (_label, url, reason) => {
    expect(() => newZitadelEndpoint(url, 'app.example.test')).toThrow(reason);
  });

  it.each([
    ['a port', 'app.example.test:443'],
    ['a scheme', 'https://app.example.test'],
    ['a path', 'app.example.test/login'],
    ['white space', 'app example.test'],
    ['nothing', ''],
  ])('refuses a claimed host with %s', (_label, host) => {
    // A ported host gives a ported issuer, which every portless check rejects.
    expect(() => newZitadelEndpoint('http://gibson-zitadel:8080', host)).toThrow(
      /bare host name/,
    );
  });
});

describe('zitadelEndpoint', () => {
  it('names each missing variable', () => {
    delete process.env.ZITADEL_URL;
    delete process.env.ZITADEL_EXTERNAL_DOMAIN;
    expect(() => zitadelEndpoint()).toThrow(/ZITADEL_URL, ZITADEL_EXTERNAL_DOMAIN/);
  });
});

describe('zitadelFetch', () => {
  it('adds the instance header and keeps the caller headers', async () => {
    const { calls } = captureFetch();
    await zitadelFetch('http://gibson-zitadel:8080/oidc/v1/userinfo', {
      headers: { Authorization: 'Bearer abc' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://gibson-zitadel:8080/oidc/v1/userinfo');
    expect(calls[0].headers.get(INSTANCE_HOST_HEADER)).toBe('app.example.test');
    expect(calls[0].headers.get('authorization')).toBe('Bearer abc');
  });

  it('overrides an instance header the caller tried to set', async () => {
    const { calls } = captureFetch();
    await zitadelFetch(new URL('http://gibson-zitadel:8080/oauth/v2/token'), {
      headers: { [INSTANCE_HOST_HEADER]: 'evil.example.test' },
    });
    expect(calls[0].headers.get(INSTANCE_HOST_HEADER)).toBe('app.example.test');
  });

  // The failing fixture of the acceptance criterion: a server-side request
  // that targets a public name does not reach the network.
  it.each([
    ['the public issuer', 'https://app.example.test/oauth/v2/token'],
    ['a discovery URL on the public host', 'https://app.example.test/.well-known/openid-configuration'],
    ['the same host on another port', 'http://gibson-zitadel:9090/oauth/v2/token'],
    ['the same host on another scheme', 'https://gibson-zitadel:8080/oauth/v2/token'],
  ])('refuses %s', async (_label, url) => {
    const { mock } = captureFetch();
    await expect(zitadelFetch(url)).rejects.toBeInstanceOf(ZitadelConnError);
    await expect(zitadelFetch(url)).rejects.toThrow(/only ZITADEL_URL/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('accepts a Request and still adds the header', async () => {
    const { calls } = captureFetch();
    await zitadelFetch(new Request('http://gibson-zitadel:8080/oauth/v2/token', { method: 'POST' }));
    expect(calls[0].headers.get(INSTANCE_HOST_HEADER)).toBe('app.example.test');
  });
});
