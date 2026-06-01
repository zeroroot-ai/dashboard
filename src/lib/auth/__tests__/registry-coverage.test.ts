/**
 * Smoke test: assert platform-sdk and OSS SDK services are present in
 * AuthRegistry.
 *
 * Imports the committed src/gen/authz/registry.ts and asserts that the
 * three-tree workspace-synthesis pipeline has populated entries for all
 * expected service namespaces:
 *
 *   - /gibson.tenant.v1.*              — OSS SDK focused tenant services
 *                                        (MembershipService, SecretsService,
 *                                        GrantsService, PluginAdminService,
 *                                        ProviderService, BudgetService,
 *                                        ModelAccessService, UserService,
 *                                        AgentIdentityService, UsageService,
 *                                        TenantService)
 *   - /gibson.daemon.operator.v1.*     — platform-sdk DaemonOperatorService
 *                                        (formerly PlatformOperatorService,
 *                                        renamed in dashboard#337)
 *
 * gibson.admin.v1, gibson.user.v1, gibson.authz.v1, gibson.budget.v1, and
 * gibson.usage.v1 have been removed from the registry as part of ADR-0039:
 * the customer-facing surfaces they served are now decomposed into focused
 * services under gibson.tenant.v1.
 *
 * Assertions are by service prefix, not specific method names, so they
 * survive RPC renames. A future silent-drop regression (e.g. buf workspace
 * synthesis failing for one tree) causes this test to fail at runtime
 * independently of the generator's exit code.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 2.3; ADR-0039.
 *
 * @module auth/__tests__/registry-coverage
 */

import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';

const allMethods = Object.keys(AuthRegistry);

describe('AuthRegistry — tenant.v1 + platform-sdk service coverage (ADR-0039)', () => {
  it('contains at least one method from gibson.tenant.v1.*', () => {
    const tenantMethods = allMethods.filter((m) => m.startsWith('/gibson.tenant.v1.'));
    expect(tenantMethods.length).toBeGreaterThan(0);
  });

  it('contains gibson.tenant.v1 secrets methods', () => {
    const secretsMethods = allMethods.filter((m) =>
      m.startsWith('/gibson.tenant.v1.SecretsService/'),
    );
    expect(secretsMethods.length).toBeGreaterThan(0);
  });

  it('contains gibson.tenant.v1 membership methods', () => {
    const membershipMethods = allMethods.filter((m) =>
      m.startsWith('/gibson.tenant.v1.MembershipService/'),
    );
    expect(membershipMethods.length).toBeGreaterThan(0);
  });

  it('contains gibson.tenant.v1 grants methods', () => {
    const grantsMethods = allMethods.filter((m) =>
      m.startsWith('/gibson.tenant.v1.GrantsService/'),
    );
    expect(grantsMethods.length).toBeGreaterThan(0);
  });

  it('contains gibson.tenant.v1 plugin admin methods', () => {
    const pluginMethods = allMethods.filter((m) =>
      m.startsWith('/gibson.tenant.v1.PluginAdminService/'),
    );
    expect(pluginMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.daemon.operator.v1.*', () => {
    // DaemonOperatorService (formerly PlatformOperatorService) lives in
    // platform-sdk at package gibson.daemon.operator.v1. dashboard#337
    // renamed the service; this assertion tracks the actual package name.
    const operatorMethods = allMethods.filter((m) => m.startsWith('/gibson.daemon.operator.v1.'));
    expect(operatorMethods.length).toBeGreaterThan(0);
  });

  it('does NOT contain deprecated gibson.admin.v1.* entries (ADR-0039)', () => {
    const adminMethods = allMethods.filter((m) => m.startsWith('/gibson.admin.v1.'));
    expect(adminMethods.length).toBe(0);
  });

  it('does NOT contain deprecated gibson.user.v1.* entries (ADR-0039)', () => {
    const userMethods = allMethods.filter((m) => m.startsWith('/gibson.user.v1.'));
    expect(userMethods.length).toBe(0);
  });

  it('registry is non-empty overall', () => {
    expect(allMethods.length).toBeGreaterThan(0);
  });
});
