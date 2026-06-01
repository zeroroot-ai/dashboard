/**
 * Unit tests for gibson-client/secrets.ts
 *
 * Mocks the underlying userClient so the tests run without a live gRPC
 * connection. Verifies that:
 * - Each method calls the correct RPC with correct arguments.
 * - Value bytes are forwarded to setSecret / rotateSecret without logging.
 * - gRPC errors are mapped to structured errors with a `code` field.
 *
 * Spec: secrets-tenant-lifecycle Task 6.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

// ---------------------------------------------------------------------------
// Mock server-only guard — vitest runs outside the Next.js runtime.
// ---------------------------------------------------------------------------
vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Mock userClient so no transport is created.
// ---------------------------------------------------------------------------
const mockSecretsClient = {
  listSecrets: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  rotateSecret: vi.fn(),
  deleteSecret: vi.fn(),
  getMissionAudit: vi.fn(),
};

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => mockSecretsClient),
}));

// Mock the proto service descriptor (not needed at runtime in tests).
vi.mock('@/src/gen/gibson/tenant/v1/secrets_pb', () => ({
  SecretsService: {},
  SecretCategory: { UNSPECIFIED: 0, CRED: 1, PROVIDER_CONFIG: 2 },
}));

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER mocks.
// ---------------------------------------------------------------------------
import {
  listSecrets,
  getSecret,
  setSecret,
  rotateSecret,
  deleteSecret,
  getMissionAudit,
} from '../secrets';
import { SecretCategory } from '@/src/gen/gibson/tenant/v1/secrets_pb';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSecretMeta(name: string) {
  return {
    name,
    category: SecretCategory.CRED,
    version: BigInt(1),
    createdAtUnix: BigInt(0),
    createdBy: 'user-1',
    updatedAtUnix: BigInt(0),
    updatedBy: 'user-1',
    lastAccessedAtUnix: BigInt(0),
    pluginAssociations: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listSecrets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls listSecrets RPC with default options and returns response', async () => {
    const expected = { secrets: [makeSecretMeta('cred:api_key')], total: 1 };
    mockSecretsClient.listSecrets.mockResolvedValue(expected);

    const result = await listSecrets();

    expect(mockSecretsClient.listSecrets).toHaveBeenCalledOnce();
    expect(mockSecretsClient.listSecrets).toHaveBeenCalledWith({
      categoryFilter: 0,
      limit: 50,
      offset: 0,
      namePrefix: '',
    });
    expect(result).toBe(expected);
  });

  it('forwards caller-supplied options', async () => {
    mockSecretsClient.listSecrets.mockResolvedValue({ secrets: [], total: 0 });

    await listSecrets({ limit: 10, offset: 20, namePrefix: 'cred:' });

    expect(mockSecretsClient.listSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, namePrefix: 'cred:' }),
    );
  });

  it('maps ConnectError to a structured error with code', async () => {
    mockSecretsClient.listSecrets.mockRejectedValue(
      new ConnectError('permission denied', Code.PermissionDenied),
    );

    const err = await listSecrets().catch((e: unknown) => e) as Error & { code: string };
    expect(err.code).toBeDefined();
    expect(err.message).toMatch(/permission denied/i);
  });
});

describe('getSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls getSecret RPC with the name', async () => {
    const meta = makeSecretMeta('cred:db_pass');
    const expected = { metadata: meta };
    mockSecretsClient.getSecret.mockResolvedValue(expected);

    const result = await getSecret('cred:db_pass');

    expect(mockSecretsClient.getSecret).toHaveBeenCalledWith({ name: 'cred:db_pass' });
    expect(result).toBe(expected);
  });

  it('propagates gRPC errors', async () => {
    mockSecretsClient.getSecret.mockRejectedValue(
      new ConnectError('not found', Code.NotFound),
    );

    await expect(getSecret('no:exist')).rejects.toThrow('not found');
  });
});

describe('setSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes name, category, and value bytes to the RPC', async () => {
    const meta = makeSecretMeta('cred:api_key');
    mockSecretsClient.setSecret.mockResolvedValue({ metadata: meta });

    const value = new TextEncoder().encode('s3cr3t');
    await setSecret('cred:api_key', SecretCategory.CRED, value);

    const call = mockSecretsClient.setSecret.mock.calls[0][0];
    // Value bytes must be forwarded — this is the critical security check.
    expect(call.value).toBe(value);
    expect(call.name).toBe('cred:api_key');
    expect(call.category).toBe(SecretCategory.CRED);
  });

  it('does not include value in thrown error message', async () => {
    mockSecretsClient.setSecret.mockRejectedValue(
      new ConnectError('broker unavailable', Code.Unavailable),
    );

    const value = new TextEncoder().encode('super-secret');
    const err = await setSecret('cred:x', SecretCategory.CRED, value).catch(
      (e: unknown) => e,
    ) as Error;

    // Error message must not contain the value string.
    expect(err.message).not.toContain('super-secret');
    expect(err.message).toMatch(/broker unavailable/i);
  });
});

describe('rotateSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls rotateSecret RPC with name and value', async () => {
    const meta = makeSecretMeta('cred:api_key');
    mockSecretsClient.rotateSecret.mockResolvedValue({ metadata: meta });

    const value = new TextEncoder().encode('new-value');
    await rotateSecret('cred:api_key', value);

    expect(mockSecretsClient.rotateSecret).toHaveBeenCalledWith({
      name: 'cred:api_key',
      value,
    });
  });
});

describe('deleteSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls deleteSecret RPC with the name', async () => {
    mockSecretsClient.deleteSecret.mockResolvedValue({});

    await deleteSecret('cred:old_key');

    expect(mockSecretsClient.deleteSecret).toHaveBeenCalledWith({ name: 'cred:old_key' });
  });
});

describe('getMissionAudit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls getMissionAudit RPC with the mission ID', async () => {
    const expected = { accesses: [], aggregationLagSeconds: 0 };
    mockSecretsClient.getMissionAudit.mockResolvedValue(expected);

    const result = await getMissionAudit('mission-123');

    expect(mockSecretsClient.getMissionAudit).toHaveBeenCalledWith({
      missionId: 'mission-123',
    });
    expect(result).toBe(expected);
  });
});
