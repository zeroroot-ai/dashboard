import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getJSON, setJSON, delKey } from '@/src/lib/redis-store';
import type { WidgetLayout, WidgetType } from '@/src/types/analytics';

/**
 * Default widget layout configuration
 */
const DEFAULT_LAYOUT: WidgetLayout = {
  cols: 12,
  rowHeight: 80,
  widgets: [
    {
      id: 'kpi-summary',
      type: 'kpi-summary' as WidgetType,
      position: { x: 0, y: 0, w: 12, h: 2 },
      visible: true,
    },
    {
      id: 'findings-chart',
      type: 'findings-chart' as WidgetType,
      position: { x: 0, y: 2, w: 8, h: 4 },
      visible: true,
    },
    {
      id: 'severity-distribution',
      type: 'severity-distribution' as WidgetType,
      position: { x: 8, y: 2, w: 4, h: 4 },
      visible: true,
    },
    {
      id: 'mission-heatmap',
      type: 'mission-heatmap' as WidgetType,
      position: { x: 0, y: 6, w: 6, h: 4 },
      visible: true,
    },
    {
      id: 'agent-performance',
      type: 'agent-performance' as WidgetType,
      position: { x: 6, y: 6, w: 6, h: 4 },
      visible: true,
    },
  ],
};

// Layout persistence uses Redis with key pattern `layout:{userId}` (no TTL).

/**
 * GET /api/user/layout
 *
 * Fetch user's saved dashboard layout.
 * Returns default layout if none exists.
 *
 * Requires authentication.
 */
export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session || !session.user?.email) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const userId = session.user.email;

    // Get user's layout from Redis or return default
    const layout = await getJSON<WidgetLayout>(`layout:${userId}`) || DEFAULT_LAYOUT;

    return NextResponse.json(layout);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}

/**
 * PUT /api/user/layout
 *
 * Save user's dashboard layout.
 *
 * Requires authentication.
 */
export async function PUT(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session || !session.user?.email) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const userId = session.user.email;

    // Parse and validate request body
    const body = await request.json();
    const layout = body as WidgetLayout;

    // Basic validation
    if (!layout.widgets || !Array.isArray(layout.widgets)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid layout format' } },
        { status: 400 }
      );
    }

    if (typeof layout.cols !== 'number' || typeof layout.rowHeight !== 'number') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid layout configuration' } },
        { status: 400 }
      );
    }

    // Validate widgets
    for (const widget of layout.widgets) {
      if (!widget.id || !widget.type || !widget.position) {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Invalid widget configuration' } },
          { status: 400 }
        );
      }

      const { x, y, w, h } = widget.position;
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof w !== 'number' ||
        typeof h !== 'number'
      ) {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Invalid widget position' } },
          { status: 400 }
        );
      }
    }

    // Save layout to Redis (persistent, no TTL)
    await setJSON(`layout:${userId}`, layout);

    return NextResponse.json({ success: true, layout });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}

/**
 * DELETE /api/user/layout
 *
 * Reset user's dashboard layout to default.
 *
 * Requires authentication.
 */
export async function DELETE(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session || !session.user?.email) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const userId = session.user.email;

    // Remove user's layout from Redis (will fallback to default on next GET)
    await delKey(`layout:${userId}`);

    return NextResponse.json({ success: true, layout: DEFAULT_LAYOUT });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}
