/**
 * GET /api/config/public — public dashboard configuration.
 *
 * Returns chart-managed values that the deploy wizard and other
 * client surfaces need to render without hardcoding URLs. Cacheable
 * (Cache-Control: max-age=300) since values are static for the pod's
 * lifetime.
 *
 * Spec: component-bootstrap-e2e Requirement 2.
 */

import { NextResponse } from 'next/server';

interface PublicConfig {
  /** Public Envoy URL the agent / tool / plugin will dial. */
  platformUrl: string;
}

export const dynamic = 'force-static';
export const revalidate = 300;

export function GET(): NextResponse<PublicConfig> {
  // GIBSON_PUBLIC_URL is provided by the Helm chart at pod start and
  // points at the Envoy edge (e.g. https://api.zero-day.ai in prod,
  // http://localhost:30002 in kind dev).
  //
  // We deliberately do not fall back to a default — surfacing a 500
  // when the env var is missing is louder than silently shipping a
  // broken default.
  const platformUrl = process.env.GIBSON_PUBLIC_URL ?? '';

  if (!platformUrl) {
    return NextResponse.json(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { error: { code: 'CONFIG_MISSING', message: 'GIBSON_PUBLIC_URL not set in pod env' } } as any,
      { status: 500 },
    );
  }

  return NextResponse.json({ platformUrl }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
