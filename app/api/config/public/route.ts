/**
 * GET /api/config/public, public dashboard configuration.
 *
 * Returns chart-managed values that the deploy wizard and other
 * client surfaces need to render without hardcoding URLs. Cacheable
 * (Cache-Control: max-age=300) since values are static for the pod's
 * lifetime.
 *
 * Spec: component-bootstrap-e2e Requirement 2.
 */

import { NextResponse } from 'next/server';
import { env } from '@/src/lib/env-validator';

interface PublicConfig {
  /** Public Envoy URL the agent / tool / plugin will dial. */
  platformUrl: string;
}

export const dynamic = 'force-static';
export const revalidate = 300;

export function GET(): NextResponse<PublicConfig> {
  // GIBSON_PUBLIC_URL is REQUIRED at boot (src/lib/env-validator.ts), the
  // pod fail-fasts via instrumentation.ts if it is absent. By the time this
  // handler runs, the var is guaranteed to be present and shape-valid.
  const platformUrl = env.GIBSON_PUBLIC_URL;

  return NextResponse.json({ platformUrl }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
