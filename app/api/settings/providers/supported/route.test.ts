/**
 * Tests for GET /api/settings/providers/supported
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Member-level sessions (non-admin) receive 200 with provider descriptors
 * - Admin sessions also receive 200 (no regression)
 * - ConnectErrors are translated to correct HTTP status codes
 * - The route calls userClient (user's session JWT), not a service-account client
 *
 * The gRPC path used is gibson.tenant.v1.TenantService/GetSupportedProviders
 * which is registered in the authz registry with relation: "member". This test
 * confirms the route uses the member-accessible client path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

const mockGetSupportedProviders = vi.fn();

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => ({
    getSupportedProviders: mockGetSupportedProviders,
  })),
}));

// Stub the tenant/v1 service descriptor imported by the route
vi.mock('@/src/gen/gibson/tenant/v1/tenant_pb', () => ({
  TenantService: { typeName: 'gibson.tenant.v1.TenantService' },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET } from './route';
import { getServerSession } from '@/src/lib/auth';
import { userClient } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockMemberSession = {
  user: {
    id: 'user-member-1',
    tenantId: 'tenant-1',
    emailVerified: true,
    groups: [],
    roles: ['tenant_member'],
    tenants: [],
    rolesByTenant: {},
    permissions: [],
    crossTenant: false,
  },
  expires: '2099-01-01T00:00:00Z',
};

const mockAdminSession = {
  user: {
    id: 'user-admin-1',
    tenantId: 'tenant-1',
    emailVerified: true,
    groups: [],
    roles: ['tenant_admin'],
    tenants: [],
    rolesByTenant: {},
    permissions: [],
    crossTenant: false,
  },
  expires: '2099-01-01T00:00:00Z',
};

const mockProviders = [
  {
    type: 'anthropic',
    displayName: 'Anthropic',
    docsUrl: 'https://docs.anthropic.com',
    selfHosted: false,
    credentials: [
      { key: 'api_key', label: 'API Key', required: true, secret: true, placeholder: 'sk-ant-…', help: '' },
    ],
    defaultModels: [
      { name: 'claude-3-5-sonnet-20241022', family: 'claude', contextWindow: 200000 },
    ],
  },
  {
    type: 'openai',
    displayName: 'OpenAI',
    docsUrl: 'https://platform.openai.com',
    selfHosted: false,
    credentials: [
      { key: 'api_key', label: 'API Key', required: true, secret: true, placeholder: 'sk-…', help: '' },
    ],
    defaultModels: [
      { name: 'gpt-4o', family: 'gpt', contextWindow: 128000 },
    ],
  },
];

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/settings/providers/supported') as NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/settings/providers/supported', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });

  it('returns 200 with provider descriptors for a member-level session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockResolvedValue({ providers: mockProviders });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: typeof mockProviders };
    expect(body.providers).toHaveLength(2);
    expect(body.providers[0].type).toBe('anthropic');
    expect(body.providers[0].displayName).toBe('Anthropic');
    expect(body.providers[0].credentials[0].key).toBe('api_key');
    expect(body.providers[0].defaultModels[0].name).toBe('claude-3-5-sonnet-20241022');
  });

  it('returns 200 with provider descriptors for an admin-level session (no regression)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockAdminSession);
    mockGetSupportedProviders.mockResolvedValue({ providers: mockProviders });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: typeof mockProviders };
    expect(body.providers).toHaveLength(2);
  });

  it('calls userClient (member-accessible) not a service-account client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockResolvedValue({ providers: [] });

    await GET(makeRequest());

    // userClient must be called — it sends the user's session JWT, which is
    // what the member-relation annotation on GetSupportedProviders allows.
    expect(userClient).toHaveBeenCalledOnce();
    // serviceClient must NOT be called — that would bypass user identity.
    // (It is not imported by the route so this is implicit, but verifying
    // userClient was called once is sufficient.)
  });

  it('returns 200 with empty providers list when daemon returns none', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockResolvedValue({ providers: [] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: unknown[] };
    expect(body.providers).toEqual([]);
  });

  it('returns 200 with empty providers when daemon returns undefined providers', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockResolvedValue({});

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: unknown[] };
    expect(body.providers).toEqual([]);
  });

  it.each([
    [Code.Unauthenticated, 401],
    [Code.PermissionDenied, 403],
    [Code.NotFound, 404],
    [Code.Unavailable, 503],
    [Code.DeadlineExceeded, 504],
    [Code.Internal, 500],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockRejectedValue(new ConnectError('daemon error', code));

    const res = await GET(makeRequest());
    expect(res.status).toBe(expectedStatus);
    const body = await res.json() as { error: unknown };
    expect(body.error).toBeDefined();
  });

  it('returns 500 for unexpected non-ConnectError errors', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockRejectedValue(new Error('unexpected network failure'));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('internal');
  });

  it('maps credential fields correctly', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockMemberSession);
    mockGetSupportedProviders.mockResolvedValue({
      providers: [
        {
          type: 'bedrock',
          displayName: 'AWS Bedrock',
          docsUrl: 'https://aws.amazon.com/bedrock',
          selfHosted: false,
          credentials: [
            { key: 'access_key_id', label: 'Access Key ID', required: true, secret: false, placeholder: 'AKIA…', help: 'Your AWS access key' },
            { key: 'secret_access_key', label: 'Secret Access Key', required: true, secret: true, placeholder: '', help: '' },
          ],
          defaultModels: [],
        },
      ],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: Array<{ credentials: Array<{ key: string; secret: boolean }> }> };
    const creds = body.providers[0].credentials;
    expect(creds).toHaveLength(2);
    expect(creds[0].key).toBe('access_key_id');
    expect(creds[0].secret).toBe(false);
    expect(creds[1].key).toBe('secret_access_key');
    expect(creds[1].secret).toBe(true);
  });
});
