import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { GibsonSession } from '@/src/lib/auth';

const mockGetServerSession = vi.fn<() => Promise<GibsonSession | null>>();

vi.mock('@/src/lib/auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

import { switchTenantAction } from '@/app/actions/tenant/switch';

function makeSession(overrides: Partial<GibsonSession['user']> = {}): GibsonSession {
  return {
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      emailVerified: true,
      groups: [],
      roles: [],
      tenants: ['acme', 'beta'],
      rolesByTenant: { acme: 'member', beta: 'admin' },
      crossTenant: false,
      ...overrides,
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

describe('switchTenantAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Not authenticated when there is no session', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await switchTenantAction('acme');
    expect(result).toEqual({ ok: false, error: 'Not authenticated' });
  });

  it('rejects slugs not in the membership list', async () => {
    mockGetServerSession.mockResolvedValueOnce(makeSession());
    const result = await switchTenantAction('ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not in your account/i);
    }
  });

  it('surfaces resolution failure when memberships list is empty', async () => {
    mockGetServerSession.mockResolvedValueOnce(
      makeSession({ tenants: [] }),
    );
    const result = await switchTenantAction('acme');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/resolve.*memberships/i);
    }
  });

  it('falls through to the PAT-stub error when validation passes', async () => {
    mockGetServerSession.mockResolvedValueOnce(makeSession());
    const result = await switchTenantAction('beta');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Membership validation passed; the action stops at the
      // not-yet-implemented Zitadel PAT step and surfaces the documented
      // error so the picker UI can show it as a toast.
      expect(result.error).toMatch(/ZITADEL_SA_PAT/);
    }
  });
});
