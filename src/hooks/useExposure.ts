// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import { useQuery } from '@tanstack/react-query';
import { readJson } from '@/src/lib/api/read-json';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { ExposureSummary } from '@/src/lib/exposure/exposure';

/** The exposure window and the revert rate of the last week, with the week before. */
export function useExposure() {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['world', tenantId, 'exposure'],
    queryFn: () => readJson<ExposureSummary>('/api/world/exposure', 'Failed to load the exposure window'),
    staleTime: 60_000,
  });
}
