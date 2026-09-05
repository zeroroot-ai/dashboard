/**
 * Health Check API Route
 * Used by Docker healthcheck and Kubernetes liveness/readiness probes
 */

import { NextResponse } from 'next/server';

export async function GET() {
  // Basic health check - application is responding
  // Could be extended to check database connections, etc.
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
