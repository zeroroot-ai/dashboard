/**
 * Unit tests for resolveEffectivePermissions in schema.ts.
 *
 * GetAuthSchema was removed from the daemon proto so the schema fetch is a
 * no-op returning empty roles. resolveEffectivePermissions must fall back to
 * static role-based derivation so server actions don't fail for all users.
 */

import { describe, it, expect } from 'vitest';
import { resolveEffectivePermissions } from '../schema';

describe('resolveEffectivePermissions — static fallback (schema no-op)', () => {
  it('owner gets members:invite', async () => {
    const perms = await resolveEffectivePermissions(['owner']);
    expect(perms).toContain('members:invite');
  });

  it('owner gets members:revoke', async () => {
    const perms = await resolveEffectivePermissions(['owner']);
    expect(perms).toContain('members:revoke');
  });

  it('admin gets members:invite', async () => {
    const perms = await resolveEffectivePermissions(['admin']);
    expect(perms).toContain('members:invite');
  });

  it('admin gets grants:create', async () => {
    const perms = await resolveEffectivePermissions(['admin']);
    expect(perms).toContain('grants:create');
  });

  it('member gets no admin permissions', async () => {
    const perms = await resolveEffectivePermissions(['member']);
    expect(perms).not.toContain('members:invite');
    expect(perms).not.toContain('grants:create');
    expect(perms).not.toContain('tenants:update');
  });

  it('empty roles returns empty', async () => {
    expect(await resolveEffectivePermissions([])).toEqual([]);
  });

  it('owner closure is superset of admin closure', async () => {
    const ownerPerms = await resolveEffectivePermissions(['owner']);
    const adminPerms = await resolveEffectivePermissions(['admin']);
    for (const p of adminPerms) {
      expect(ownerPerms).toContain(p);
    }
  });

  it('member does not get tenants:provision', async () => {
    const perms = await resolveEffectivePermissions(['member']);
    expect(perms).not.toContain('tenants:provision');
  });

  it('admin does not get tenants:provision (cross-tenant only)', async () => {
    const perms = await resolveEffectivePermissions(['admin']);
    expect(perms).not.toContain('tenants:provision');
  });

  it('platform_operator gets tenants:provision', async () => {
    const perms = await resolveEffectivePermissions(['platform_operator']);
    expect(perms).toContain('tenants:provision');
  });
});
