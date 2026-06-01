/**
 * GET/PUT/DELETE /api/user/layout
 *
 * Proxies per-user dashboard widget layout through the daemon's UserService RPCs
 * (GetUserLayout / SaveUserLayout / ResetUserLayout).
 * Tenant is resolved via requireActiveTenant() — fail-closed, no default fallback.
 *
 * Replaces the previous direct-Redis implementation.
 * Spec: dashboard-no-backing-store-clients (Module 5 / issue #589).
 */

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { UserService } from '@/src/gen/gibson/tenant/v1/user_pb';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import type { WidgetLayout, WidgetType } from '@/src/types/analytics';
import type { UserLayoutPreferences, WidgetConfig } from '@/src/gen/gibson/tenant/v1/user_pb';

// ============================================================================
// Conversion helpers — proto ↔ local WidgetLayout
// ============================================================================

function protoToLayout(proto: UserLayoutPreferences): WidgetLayout {
  return {
    cols: proto.cols || 12,
    rowHeight: proto.rowHeight || 80,
    widgets: proto.widgets.map((w) => ({
      id: w.id,
      type: w.type as WidgetType,
      position: {
        x: w.position?.x ?? 0,
        y: w.position?.y ?? 0,
        w: w.position?.w ?? 4,
        h: w.position?.h ?? 2,
      },
      visible: w.visible,
    })),
  };
}

function layoutToProto(layout: WidgetLayout): UserLayoutPreferences {
  return {
    $typeName: 'gibson.tenant.v1.UserLayoutPreferences' as const,
    cols: layout.cols,
    rowHeight: layout.rowHeight,
    widgets: layout.widgets.map((w): WidgetConfig => ({
      $typeName: 'gibson.tenant.v1.WidgetConfig' as const,
      id: w.id,
      type: w.type,
      position: {
        $typeName: 'gibson.tenant.v1.WidgetPosition' as const,
        x: w.position.x,
        y: w.position.y,
        w: w.position.w,
        h: w.position.h,
      },
      visible: w.visible ?? true,
      settingsJson: '',
    })),
  };
}

// ============================================================================
// GET /api/user/layout
// ============================================================================

export async function GET(_request: NextRequest) {
  const session = await getServerSession();
  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const resp = await userClient(UserService).getUserLayout({
      tenantId,
      userId: session.user.id,
    });
    const layout = resp.layout ? protoToLayout(resp.layout) : defaultLayout();
    return NextResponse.json(layout);
  } catch (err) {
    return daemonErrorResponse(err);
  }
}

// ============================================================================
// PUT /api/user/layout
// ============================================================================

export async function PUT(request: NextRequest) {
  const session = await getServerSession();
  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  let layout: WidgetLayout;
  try {
    layout = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid layout format' } },
      { status: 400 },
    );
  }

  // Basic validation
  if (!layout.widgets || !Array.isArray(layout.widgets)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid layout format' } },
      { status: 400 },
    );
  }
  if (typeof layout.cols !== 'number' || typeof layout.rowHeight !== 'number') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid layout configuration' } },
      { status: 400 },
    );
  }
  for (const widget of layout.widgets) {
    if (!widget.id || !widget.type || !widget.position) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid widget configuration' } },
        { status: 400 },
      );
    }
    const { x, y, w, h } = widget.position;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid widget position' } },
        { status: 400 },
      );
    }
  }

  try {
    const resp = await userClient(UserService).saveUserLayout({
      tenantId,
      userId: session.user.id,
      layout: layoutToProto(layout),
    });
    const saved = resp.layout ? protoToLayout(resp.layout) : layout;
    return NextResponse.json({ success: true, layout: saved });
  } catch (err) {
    return daemonErrorResponse(err);
  }
}

// ============================================================================
// DELETE /api/user/layout
// ============================================================================

export async function DELETE(_request: NextRequest) {
  const session = await getServerSession();
  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    await userClient(UserService).resetUserLayout({
      tenantId,
      userId: session.user.id,
    });
    return NextResponse.json({ success: true, layout: defaultLayout() });
  } catch (err) {
    return daemonErrorResponse(err);
  }
}

// ============================================================================
// Default layout (returned on reset and when daemon returns is_default=true)
// ============================================================================

function defaultLayout(): WidgetLayout {
  return {
    cols: 12,
    rowHeight: 80,
    widgets: [
      { id: 'kpi-summary', type: 'kpi-summary' as WidgetType, position: { x: 0, y: 0, w: 12, h: 2 }, visible: true },
      { id: 'findings-chart', type: 'findings-chart' as WidgetType, position: { x: 0, y: 2, w: 8, h: 4 }, visible: true },
      { id: 'severity-distribution', type: 'severity-distribution' as WidgetType, position: { x: 8, y: 2, w: 4, h: 4 }, visible: true },
      { id: 'mission-heatmap', type: 'mission-heatmap' as WidgetType, position: { x: 0, y: 6, w: 6, h: 4 }, visible: true },
      { id: 'agent-performance', type: 'agent-performance' as WidgetType, position: { x: 6, y: 6, w: 6, h: 4 }, visible: true },
    ],
  };
}
