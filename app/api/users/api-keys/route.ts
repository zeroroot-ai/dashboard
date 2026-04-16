import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { checkRateLimit, createRateLimitResponse, getRateLimitHeaders, RATE_LIMIT_PRESETS } from '@/src/lib/rate-limiter';
import { createAPIKey, listAPIKeys, revokeAPIKey } from '@/src/lib/gibson-client';

interface CreateAPIKeyRequest {
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}

/** Rate limit configuration for API key operations: 10 requests/hour/user */
const API_KEY_RATE_LIMIT = RATE_LIMIT_PRESETS.apiKey;

/**
 * GET /api/users/api-keys
 *
 * List API keys for the current user's tenant.
 * Keys are fetched from the Gibson daemon (Redis-backed persistence).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const rateLimitResult = await checkRateLimit(request, 'api-keys', API_KEY_RATE_LIMIT);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, API_KEY_RATE_LIMIT.message);
    }

    const tenantId = session.user.tenantId ?? 'default';
    const keys = await listAPIKeys(tenantId, session?.user?.id);

    // Map daemon key records to the user-facing shape (strip internal fields)
    const userKeys = keys.map((k) => ({
      id: k.keyId,
      name: k.name || k.allowedNames?.[0] || 'API Key',
      scopes: k.allowedKinds ?? [],
      createdAt: k.createdAt,
      status: 'active',
    }));

    const response = NextResponse.json({ keys: userKeys });
    const headers = getRateLimitHeaders(rateLimitResult);
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    return safeErrorResponse(error, 'Failed to list API keys', 500);
  }
}

/**
 * POST /api/users/api-keys
 *
 * Create a new API key via the Gibson daemon.
 * The daemon generates and persists the key in Redis.
 *
 * IMPORTANT: The full key is only returned once in the response.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const body = (await request.json()) as CreateAPIKeyRequest;

    // Validate name
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Key name is required' } },
        { status: 400 }
      );
    }

    if (body.name.length > 100) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Key name must be 100 characters or less' } },
        { status: 400 }
      );
    }

    const sanitizedName = body.name.trim().replace(/[<>]/g, '');

    const rateLimitResult = await checkRateLimit(request, 'api-keys', API_KEY_RATE_LIMIT);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, API_KEY_RATE_LIMIT.message);
    }

    // Create key via daemon RPC. Model user keys as allowedKinds=["user"],
    // with the key name in allowedNames for identification.
    const tenantId = session.user.tenantId ?? 'default';
    const result = await createAPIKey(
      tenantId,
      ['user'],
      [sanitizedName],
      session?.user?.id
    );

    const prefix = result.rawKey.slice(0, 12) + '...';

    const response = NextResponse.json(
      {
        key: {
          id: result.keyId,
          name: sanitizedName,
          prefix,
          token: result.rawKey,
          scopes: body.scopes ?? ['mission:read', 'findings:read'],
          createdAt: new Date().toISOString(),
          status: 'active',
        },
        warning: 'This is the only time you will see this API key. Please save it securely.',
      },
      { status: 201 }
    );
    const headers = getRateLimitHeaders(rateLimitResult);
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create API key', 500);
  }
}

/**
 * DELETE /api/users/api-keys
 *
 * Revoke an API key via the Gibson daemon.
 *
 * Query parameters:
 * - keyId: ID of the key to revoke (required)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const keyId = searchParams.get('keyId');

    if (!keyId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'keyId is required' } },
        { status: 400 }
      );
    }

    const rateLimitResult = await checkRateLimit(request, 'api-keys', API_KEY_RATE_LIMIT);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, API_KEY_RATE_LIMIT.message);
    }

    const tenantId = session.user.tenantId ?? 'default';
    await revokeAPIKey(tenantId, keyId, session?.user?.id);

    const response = NextResponse.json({
      success: true,
      message: 'API key revoked successfully',
      keyId,
    });
    const headers = getRateLimitHeaders(rateLimitResult);
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    return safeErrorResponse(error, 'Failed to revoke API key', 500);
  }
}
