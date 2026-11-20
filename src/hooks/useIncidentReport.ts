// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import { useQuery } from '@tanstack/react-query';
import { readJson } from '@/src/lib/api/read-json';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { IncidentReportView } from '@/src/lib/incidents/incident-report';

/** The report of one incident. */
export function useIncidentReport(incidentKey: string) {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['incident-report', tenantId, incidentKey],
    queryFn: () =>
      readJson<IncidentReportView>(
        `/api/incidents/${encodeURIComponent(incidentKey)}/report`,
        'Failed to load the incident report',
      ),
    staleTime: 30_000,
  });
}
