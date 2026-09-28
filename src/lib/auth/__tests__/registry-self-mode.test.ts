// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The generated registry must carry AuthOptions.self for the membership
 * bootstrap. assertAuthorized stops at a self-mode entry before it reads
 * memberships; without the flag, getMyMemberships() -> ListMyMemberships ->
 * assertAuthorized -> getMyMemberships() never ends, and the dashboard runs
 * out of heap after a tenant member signs in (hosted#208). This reads the
 * real generated file, so a generator that drops the flag fails here.
 */
import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';

describe('generated AuthRegistry, self-mode', () => {
  it('marks ListMyMemberships as self-mode', () => {
    expect(AuthRegistry['/gibson.daemon.v1.DaemonService/ListMyMemberships']?.self).toBe(true);
  });

  it('carries the self flag on every entry', () => {
    const missing = Object.keys(AuthRegistry).filter((m) => typeof AuthRegistry[m]?.self !== 'boolean');
    expect(missing).toEqual([]);
  });
});
