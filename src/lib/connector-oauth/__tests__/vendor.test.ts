/**
 * The vendor URL guard. These are the SSRF rails for a server-side fetch to
 * an operator-supplied URL: https only, no loopback, no link-local (which
 * includes the cloud metadata endpoint). Private RFC 1918 ranges stay allowed
 * on purpose — a self-managed GitLab on internal addressing is the topology
 * this feature exists for.
 */
import { describe, expect, it } from 'vitest';

import { assertVendorUrlSafe } from '../vendor';

describe('assertVendorUrlSafe', () => {
  it('rejects a non-URL', async () => {
    await expect(assertVendorUrlSafe('not a url')).rejects.toThrow(/not a valid URL/);
  });

  it('rejects http', async () => {
    await expect(assertVendorUrlSafe('http://gitlab.example.com')).rejects.toThrow(/https/);
  });

  it('rejects loopback addresses', async () => {
    await expect(assertVendorUrlSafe('https://127.0.0.1')).rejects.toThrow(/forbidden/);
    await expect(assertVendorUrlSafe('https://[::1]')).rejects.toThrow(/forbidden/);
  });

  it('rejects link-local, which covers the cloud metadata endpoint', async () => {
    await expect(assertVendorUrlSafe('https://169.254.169.254')).rejects.toThrow(/forbidden/);
    await expect(assertVendorUrlSafe('https://[fe80::1]')).rejects.toThrow(/forbidden/);
  });

  it('allows private RFC 1918 addressing — the self-managed enterprise topology', async () => {
    await expect(assertVendorUrlSafe('https://10.20.30.40')).resolves.toBeInstanceOf(URL);
    await expect(assertVendorUrlSafe('https://192.168.1.10')).resolves.toBeInstanceOf(URL);
  });

  it('rejects a hostname that does not resolve', async () => {
    await expect(
      assertVendorUrlSafe('https://this-host-does-not-exist.invalid'),
    ).rejects.toThrow(/does not resolve/);
  });
});
