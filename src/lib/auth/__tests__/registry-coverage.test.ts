/**
 * Smoke test: assert daemon-local services are present in AuthRegistry.
 *
 * Imports the committed src/gen/authz/registry.ts and asserts that the
 * dual-tree workspace-synthesis pipeline (task 12) has populated entries for
 * all four expected service namespaces:
 *
 *   - /gibson.tenant.v1.*   — OSS SDK TenantService (ADR-0037: migrated from TenantAdminService)
 *   - /gibson.platform.v1.* — daemon-local PlatformOperatorService
 *   - /gibson.user.v1.*     — daemon-local UserService
 *   - /gibson.admin.v1.*    — SDK AdminService regression net
 *
 * Assertions are by service prefix, not specific method names, so they
 * survive RPC renames. A future silent-drop regression (e.g. buf workspace
 * synthesis failing for one tree) causes this test to fail at runtime
 * independently of the generator's exit code.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 2.3.
 *
 * @module auth/__tests__/registry-coverage
 */

import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';

const allMethods = Object.keys(AuthRegistry);

describe('AuthRegistry — daemon-local service coverage (cross-repo-cohesion-fixes task 12)', () => {
  it('contains at least one method from gibson.tenant.v1.*', () => {
    const tenantMethods = allMethods.filter((m) => m.startsWith('/gibson.tenant.v1.'));
    expect(tenantMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.platform.v1.*', () => {
    const platformMethods = allMethods.filter((m) => m.startsWith('/gibson.platform.v1.'));
    expect(platformMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.user.v1.*', () => {
    const userMethods = allMethods.filter((m) => m.startsWith('/gibson.user.v1.'));
    expect(userMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.admin.v1.* (SDK regression net)', () => {
    const adminMethods = allMethods.filter((m) => m.startsWith('/gibson.admin.v1.'));
    expect(adminMethods.length).toBeGreaterThan(0);
  });

  it('registry is non-empty overall', () => {
    expect(allMethods.length).toBeGreaterThan(0);
  });
});
