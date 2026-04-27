import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSupportedProviders } from '../useSupportedProviders';
import { createTestQueryClient } from '@/src/test/test-utils';
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';

// Mock the RPC wrapper so the hook test stays purely at the client boundary.
vi.mock('@/src/lib/gibson-client', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/gibson-client')>(
    '@/src/lib/gibson-client',
  );
  return {
    ...actual,
    getSupportedProviders: vi.fn(),
  };
});

import { getSupportedProviders } from '@/src/lib/gibson-client';

const mockDescriptors: SupportedProviderDescriptor[] = [
  {
    type: 'anthropic',
    displayName: 'Anthropic (Claude)',
    docsUrl: 'https://docs.anthropic.com/',
    selfHosted: false,
    credentials: [
      { key: 'api_key', label: 'Anthropic API Key', required: true, secret: true, placeholder: '', help: '' },
    ],
    defaultModels: [],
  },
  {
    type: 'bedrock',
    displayName: 'AWS Bedrock',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/',
    selfHosted: false,
    credentials: [
      { key: 'aws_region', label: 'AWS Region', required: false, secret: false, placeholder: 'us-east-1', help: '' },
      { key: 'aws_access_key_id', label: 'AWS Access Key ID', required: false, secret: true, placeholder: '', help: '' },
      { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', required: false, secret: true, placeholder: '', help: '' },
    ],
    defaultModels: [
      { name: 'anthropic.claude-3-haiku-20240307-v1:0', contextWindow: 200000, maxOutput: 4096, features: ['chat', 'streaming', 'tools'] },
    ],
  },
  {
    type: 'ollama',
    displayName: 'Ollama',
    docsUrl: 'https://ollama.com/',
    selfHosted: true,
    credentials: [],
    defaultModels: [],
  },
];

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSupportedProviders', () => {
  beforeEach(() => {
    vi.mocked(getSupportedProviders).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the descriptor list from the daemon RPC', async () => {
    vi.mocked(getSupportedProviders).mockResolvedValue(mockDescriptors);

    const { result } = renderHook(() => useSupportedProviders(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockDescriptors);
    expect(getSupportedProviders).toHaveBeenCalledTimes(1);
  });

  it('caches across re-renders (staleTime 5 min)', async () => {
    vi.mocked(getSupportedProviders).mockResolvedValue(mockDescriptors);
    const client = createTestQueryClient();

    const first = renderHook(() => useSupportedProviders(), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    // A second hook call with the same query client should hit the cache,
    // not the RPC.
    const second = renderHook(() => useSupportedProviders(), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(getSupportedProviders).toHaveBeenCalledTimes(1);
  });

  it('surfaces RPC errors as isError', async () => {
    vi.mocked(getSupportedProviders).mockRejectedValue(new Error('daemon unreachable'));

    const { result } = renderHook(() => useSupportedProviders(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('daemon unreachable');
  });

  it('preserves descriptor shape for self-hosted and BYOK categories', async () => {
    vi.mocked(getSupportedProviders).mockResolvedValue(mockDescriptors);

    const { result } = renderHook(() => useSupportedProviders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byType = new Map((result.current.data ?? []).map((d) => [d.type, d]));
    expect(byType.get('ollama')?.selfHosted).toBe(true);
    expect(byType.get('bedrock')?.selfHosted).toBe(false);
    const bedrock = byType.get('bedrock');
    expect(bedrock?.credentials.find((c) => c.key === 'aws_secret_access_key')?.secret).toBe(true);
    expect(bedrock?.defaultModels[0]?.features).toContain('tools');
  });
});
