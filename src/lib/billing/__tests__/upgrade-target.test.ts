/**
 * Tests for getUpgradeTarget. Spec plans-and-quotas-simplification R9.B.6.
 */

import { describe, it, expect } from 'vitest';

import { getUpgradeTarget } from '../upgrade-target';

describe('getUpgradeTarget', () => {
  it('routes team → Stripe portal targeting enterprise', () => {
    const target = getUpgradeTarget('team');
    expect(target).not.toBeNull();
    expect(target?.label).toMatch(/upgrade to enterprise/i);
    expect(target?.href).toContain('/billing/upgrade?target=enterprise');
  });

  it('routes enterprise → contact sales', () => {
    const target = getUpgradeTarget('enterprise');
    expect(target).not.toBeNull();
    expect(target?.label).toMatch(/talk to sales/i);
    expect(target?.href).toContain('/contact-sales');
  });

  it('returns null for enterprise-deploy (no upgrade path)', () => {
    expect(getUpgradeTarget('enterprise-deploy')).toBeNull();
  });

  it('returns null for unknown plan ids', () => {
    expect(getUpgradeTarget('totally-unknown')).toBeNull();
    expect(getUpgradeTarget(undefined)).toBeNull();
  });
});
