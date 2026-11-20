// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import { useQuery } from '@tanstack/react-query';
import { readJson } from '@/src/lib/api/read-json';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { FindingActivityEvent } from '@/src/lib/findings/activity';

export interface FindingActivity {
  events: FindingActivityEvent[];
  /** True when the read of the Timeline stopped before its end. */
  truncated: boolean;
  exposure: {
    /** False when the Timeline holds no event for the finding. */
    found: boolean;
    verified: boolean;
    totalSeconds: number;
    waitSeconds: number;
    agentSeconds: number;
  };
}

/** The events of one finding on the Timeline, with its agent time and wait time. */
export function useFindingActivity(findingId: string) {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['world', tenantId, 'finding-activity', findingId],
    queryFn: () =>
      readJson<FindingActivity>(
        `/api/world/finding-activity?finding=${encodeURIComponent(findingId)}`,
        'Failed to load the activity of the finding',
      ),
    staleTime: 30_000,
  });
}
