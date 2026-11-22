// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import { useQuery } from '@tanstack/react-query';
import { readJson } from '@/src/lib/api/read-json';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { OpenFinding } from '@/src/lib/findings/open-findings';

interface OpenFindingsResponse {
  findings: OpenFinding[];
  /** Set when the daemon holds more findings after this page. */
  nextCursor?: string;
}

/** The first page of the findings that are not verified, in the rank order of the daemon. */
export function useOpenFindings(limit: number) {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['world', tenantId, 'open-findings', limit],
    queryFn: () =>
      readJson<OpenFindingsResponse>(
        `/api/world/open-findings?limit=${limit}`,
        'Failed to load the open findings',
      ),
    staleTime: 30_000,
  });
}
