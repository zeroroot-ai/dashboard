/**
 * Smoke test: assert platform-sdk and daemon-local services are present in
 * AuthRegistry.
 *
 * Imports the committed src/gen/authz/registry.ts and asserts that the
 * three-tree workspace-synthesis pipeline has populated entries for all four
 * expected service namespaces:
 *
 *   - /gibson.tenant.v1.*              — OSS SDK TenantService
 *   - /gibson.daemon.operator.v1.*     — platform-sdk DaemonOperatorService
 *                                        (formerly PlatformOperatorService,
 *                                        renamed in dashboard#337)
 *   - /gibson.user.v1.*               — platform-sdk / daemon-local UserService
 *   - /gibson.admin.v1.*              — platform-sdk admin services
 *                                        (TenantAdminService, SecretsAdminService,
 *                                        GrantsAdminService, PluginsAdminService)
 *
 * Assertions are by service prefix, not specific method names, so they
 * survive RPC renames. A future silent-drop regression (e.g. buf workspace
 * synthesis failing for one tree) causes this test to fail at runtime
 * independently of the generator's exit code.
 *
 * dashboard#406: gen-authz-registry.mjs now includes platform-sdk-proto as a
 * third FDS input alongside sdk-proto and gibson-local, which is required to
 * populate the gibson.admin.v1.* and gibson.daemon.operator.v1.* namespaces.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 2.3.
 *
 * @module auth/__tests__/registry-coverage
 */

import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';

const allMethods = Object.keys(AuthRegistry);

describe('AuthRegistry — platform-sdk + daemon-local service coverage (dashboard#406)', () => {
  it('contains at least one method from gibson.tenant.v1.*', () => {
    const tenantMethods = allMethods.filter((m) => m.startsWith('/gibson.tenant.v1.'));
    expect(tenantMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.daemon.operator.v1.*', () => {
    // DaemonOperatorService (formerly PlatformOperatorService) lives in
    // platform-sdk at package gibson.daemon.operator.v1. dashboard#337
    // renamed the service; this assertion tracks the actual package name.
    const operatorMethods = allMethods.filter((m) => m.startsWith('/gibson.daemon.operator.v1.'));
    expect(operatorMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.user.v1.*', () => {
    const userMethods = allMethods.filter((m) => m.startsWith('/gibson.user.v1.'));
    expect(userMethods.length).toBeGreaterThan(0);
  });

  it('contains at least one method from gibson.admin.v1.*', () => {
    // gibson.admin.v1 lives in platform-sdk (TenantAdminService,
    // SecretsAdminService, GrantsAdminService, PluginsAdminService).
    // dashboard#406: was absent because gen-authz-registry.mjs did not
    // include the platform-sdk-proto module.
    const adminMethods = allMethods.filter((m) => m.startsWith('/gibson.admin.v1.'));
    expect(adminMethods.length).toBeGreaterThan(0);
  });

  it('registry is non-empty overall', () => {
    expect(allMethods.length).toBeGreaterThan(0);
  });
});
