// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import { useQuery } from '@tanstack/react-query';
import { readJson } from '@/src/lib/api/read-json';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { ActionsByGrant } from '@/src/lib/actions/actions-by-grant';

/**
 * What the agents did in the last 24 hours, by grant and by grantor. The read
 * needs the admin relation, so the caller passes `enabled` false for a person
 * who lacks it, and no request goes out.
 */
export function useActionsByGrant(enabled: boolean) {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['world', tenantId, 'actions-by-grant'],
    queryFn: () =>
      readJson<ActionsByGrant>('/api/world/actions-by-grant', 'Failed to load the actions of the agents'),
    enabled,
    staleTime: 30_000,
  });
}
