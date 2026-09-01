/**
 * Smoke test: assert platform-sdk and OSS SDK services are present in
 * AuthRegistry.
 *
 * Imports the committed src/gen/authz/registry.ts and asserts that the
 * three-tree workspace-synthesis pipeline has populated entries for all
 * expected service namespaces:
 *
 *   - /gibson.tenant.v1.*             , OSS SDK focused tenant services
 *                                        (MembershipService, SecretsService,
 *                                        GrantsService, PluginAdminService,
 *                                        ProviderService, BudgetService,
 *                                        ModelAccessService, UserService,
 *                                        AgentIdentityService, UsageService,
 *                                        TenantService)
 *   - /gibson.daemon.operator.v1.*    , platform-sdk DaemonOperatorService
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

describe('AuthRegistry, tenant.v1 + platform-sdk service coverage (ADR-0039)', () => {
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
      m.startsWith('/gibson.pluginadmin.v1.PluginAdminService/'),
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

  it('contains gibson.bank.v1 BankService methods (gibson#1706 lane E7)', () => {
    const bankMethods = allMethods.filter((m) =>
      m.startsWith('/gibson.bank.v1.BankService/'),
    );
    expect(bankMethods).toEqual(
      expect.arrayContaining([
        '/gibson.bank.v1.BankService/CreateBank',
        '/gibson.bank.v1.BankService/ListBanks',
        '/gibson.bank.v1.BankService/GetBank',
        '/gibson.bank.v1.BankService/UpdateBank',
        '/gibson.bank.v1.BankService/DeleteBank',
        '/gibson.bank.v1.BankService/ListMembers',
        '/gibson.bank.v1.BankService/StartSignIn',
        '/gibson.bank.v1.BankService/StreamSignIn',
        '/gibson.bank.v1.BankService/SubmitSignInCode',
      ]),
    );
  });

  it('contains gibson.job.v1 JobService methods (gibson#1706 lane E7)', () => {
    const jobMethods = allMethods.filter((m) =>
      m.startsWith('/gibson.job.v1.JobService/'),
    );
    expect(jobMethods).toEqual(
      expect.arrayContaining([
        '/gibson.job.v1.JobService/OpenJob',
        '/gibson.job.v1.JobService/SendInput',
        '/gibson.job.v1.JobService/CloseJob',
        '/gibson.job.v1.JobService/GetJob',
        '/gibson.job.v1.JobService/ListJobs',
        '/gibson.job.v1.JobService/StreamJobEvents',
      ]),
    );
  });

  it('bank and job entries name the bank or job object, never the tenant, for per-object RPCs', () => {
    // The dashboard cannot decide these from a tenant role; the daemon does.
    // A regression that re-annotates one of them against the tenant would let
    // any member pass the dashboard gate for another owner's bank.
    const perObject = [
      ['/gibson.bank.v1.BankService/GetBank', 'bank', 'can_read'],
      ['/gibson.bank.v1.BankService/UpdateBank', 'bank', 'owner'],
      ['/gibson.bank.v1.BankService/DeleteBank', 'bank', 'owner'],
      ['/gibson.bank.v1.BankService/StartSignIn', 'bank', 'owner'],
      ['/gibson.job.v1.JobService/OpenJob', 'bank', 'can_send'],
      ['/gibson.job.v1.JobService/SendInput', 'job', 'can_send'],
      ['/gibson.job.v1.JobService/CloseJob', 'job', 'can_close'],
      ['/gibson.job.v1.JobService/GetJob', 'job', 'can_read'],
    ] as const;
    for (const [method, objectType, relation] of perObject) {
      expect(AuthRegistry[method]?.objectType, method).toBe(objectType);
      expect(AuthRegistry[method]?.relation, method).toBe(relation);
    }
    expect(AuthRegistry['/gibson.bank.v1.BankService/CreateBank']?.relation).toBe('writer');
    expect(AuthRegistry['/gibson.bank.v1.BankService/ListBanks']?.relation).toBe('member');
    expect(AuthRegistry['/gibson.job.v1.JobService/ListJobs']?.relation).toBe('member');
  });

  it('registry is non-empty overall', () => {
    expect(allMethods.length).toBeGreaterThan(0);
  });
});
