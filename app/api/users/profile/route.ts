import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getUserProfile, updateUserProfile } from '@/src/lib/gibson-client';
import type {
  UserProfile,
  UpdateUserProfileRequest,
} from '@/src/types/user';

/**
 * GET /api/users/profile
 *
 * Get the current user's profile.
 *
 * Returns user profile information for self-service display.
 */
export async function GET() {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'No tenant context available' } },
        { status: 400 }
      );
    }

    try {
      const data = await getUserProfile(tenantId, session.user.id ?? 'unknown');
      return NextResponse.json(data);
    } catch {
      // RPC not yet available — fall back to session data
      const profile: UserProfile = {
        id: session.user.id || 'unknown',
        email: session.user.email || '',
        displayName: session.user.name || '',
        avatarUrl: session.user.image || undefined,
        tenantId,
        roles: session.user.roles || [],
        status: 'active',
        createdAt: new Date().toISOString(),
        preferences: {
          emailNotifications: {
            missionCompletion: true,
            findingAlerts: true,
            teamInvitations: true,
            weeklySummary: true,
            deliveryTime: 'immediate',
          },
          inAppNotifications: {
            missionStatusChanges: true,
            newFindings: true,
          } as any,
        },
      };
      return NextResponse.json({ profile });
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}

/**
 * PUT /api/users/profile
 *
 * Update the current user's profile.
 *
 * Request body:
 * - displayName: New display name (optional)
 * - avatarUrl: New avatar URL or base64 data URL (optional)
 * - preferences: Updated preferences (optional, partial)
 */
export async function PUT(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Parse request body
    const body = (await request.json()) as UpdateUserProfileRequest;

    // Validate displayName if provided
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string' || body.displayName.trim().length === 0) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Display name cannot be empty' } },
          { status: 400 }
        );
      }

      if (body.displayName.length > 100) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Display name must be 100 characters or less' } },
          { status: 400 }
        );
      }

      // Sanitize display name (basic XSS prevention)
      body.displayName = body.displayName.trim().replace(/[<>]/g, '');
    }

    // Validate avatarUrl if provided
    if (body.avatarUrl !== undefined) {
      if (typeof body.avatarUrl !== 'string') {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid avatar URL' } },
          { status: 400 }
        );
      }

      // Validate URL format or data URL
      const isValidUrl = body.avatarUrl.startsWith('https://') ||
        body.avatarUrl.startsWith('data:image/');

      if (!isValidUrl) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Avatar must be a secure URL or data URL' } },
          { status: 400 }
        );
      }

      // Limit data URL size (1MB)
      if (body.avatarUrl.startsWith('data:') && body.avatarUrl.length > 1024 * 1024) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Avatar image must be less than 1MB' } },
          { status: 400 }
        );
      }
    }

    // Validate preferences if provided
    if (body.preferences !== undefined) {
      // Validate timezone if provided
      if (body.preferences.timezone !== undefined) {
        // Basic timezone validation (should be IANA format)
        try {
          Intl.DateTimeFormat(undefined, { timeZone: body.preferences.timezone });
        } catch {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Invalid timezone' } },
            { status: 400 }
          );
        }
      }

      // Validate language if provided
      if (body.preferences.language !== undefined) {
        const validLanguages = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt'];
        if (!validLanguages.includes(body.preferences.language)) {
          return NextResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: `Language must be one of: ${validLanguages.join(', ')}`,
              },
            },
            { status: 400 }
          );
        }
      }

      // Validate delivery time if provided
      if (body.preferences.emailNotifications?.deliveryTime !== undefined) {
        const validTimes = ['immediate', 'daily', 'weekly'];
        if (!validTimes.includes(body.preferences.emailNotifications.deliveryTime)) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery time' } },
            { status: 400 }
          );
        }
      }
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'No tenant context available' } },
        { status: 400 }
      );
    }

    try {
      const result = await updateUserProfile(tenantId, session.user.id ?? 'unknown', body as Record<string, unknown>);
      return NextResponse.json(result);
    } catch {
      // RPC not yet available
      return NextResponse.json(
        { error: { code: 'NOT_IMPLEMENTED', message: 'Profile updates not yet connected to backend' } },
        { status: 501 }
      );
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}
