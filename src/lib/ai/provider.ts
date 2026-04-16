/**
 * AI Provider Resolver
 *
 * Maps the configured BYOK LLM provider to a Vercel AI SDK model instance.
 * Fetches provider configuration from the Gibson daemon via RPC.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { ProviderType } from '@/src/types/provider';
import { listProviders, type ListProvidersResult, type ProviderRecord } from '@/src/lib/gibson-client';

// Default models per provider when none is configured
const DEFAULT_MODELS: Record<ProviderType, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.0-flash',
  ollama: 'llama3.2',
  azure_openai: 'gpt-4o',
  aws_bedrock: 'anthropic.claude-3-sonnet-20240229-v1:0',
};

export interface ResolvedProvider {
  model: LanguageModel;
  providerName: string;
  modelId: string;
}

/**
 * Resolve the configured default provider into an AI SDK LanguageModel.
 *
 * Fetches current provider config from the daemon on each call.
 *
 * @throws ProviderNotConfiguredError if no provider is configured or enabled
 * @throws ProviderKeyMissingError if required credentials are missing
 */
export async function resolveProvider(tenantId: string): Promise<ResolvedProvider> {
  let data: ListProvidersResult;
  try {
    data = await listProviders(tenantId);
  } catch {
    throw new ProviderNotConfiguredError('Unable to fetch provider configuration from daemon.');
  }

  const providerList = data.providers ?? [];
  const defaultName = data.defaultProvider;

  if (!defaultName) {
    throw new ProviderNotConfiguredError();
  }

  const config = providerList.find((p: ProviderRecord) => p.name === defaultName);
  if (!config) {
    throw new ProviderNotConfiguredError();
  }

  if (!config.isEnabled) {
    throw new ProviderNotConfiguredError(
      `Provider "${config.displayName}" is disabled. Enable it in Settings > Providers.`
    );
  }

  const apiKey = config.apiKey as string | undefined;
  const modelId = (config.defaultModel || DEFAULT_MODELS[config.type as ProviderType]) as string;

  switch (config.type) {
    case 'anthropic': {
      if (!apiKey) throw new ProviderKeyMissingError('Anthropic');
      const provider = createAnthropic({ apiKey });
      return { model: provider(modelId), providerName: 'Anthropic', modelId };
    }

    case 'openai': {
      if (!apiKey) throw new ProviderKeyMissingError('OpenAI');
      const provider = createOpenAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl as string } : {}),
      });
      return { model: provider(modelId), providerName: 'OpenAI', modelId };
    }

    case 'google': {
      if (!apiKey) throw new ProviderKeyMissingError('Google AI');
      const provider = createGoogleGenerativeAI({ apiKey });
      return { model: provider(modelId), providerName: 'Google AI', modelId };
    }

    case 'ollama': {
      const baseURL = (config.baseUrl as string) || 'http://localhost:11434/v1';

      // Validate the Ollama baseUrl to prevent SSRF against cloud metadata
      // endpoints. Localhost and private-network addresses are allowed since
      // Ollama legitimately runs on private infrastructure.
      try {
        const parsed = new URL(baseURL);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Ollama URL must use HTTP or HTTPS protocol');
        }
        const blockedHosts = ['169.254.169.254', 'metadata.google.internal'];
        if (blockedHosts.includes(parsed.hostname)) {
          throw new Error('Ollama URL must not point to cloud metadata endpoints');
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Ollama URL')) throw err;
        throw new Error('Invalid Ollama base URL');
      }

      const provider = createOpenAI({ baseURL, apiKey: 'ollama' });
      return { model: provider(modelId), providerName: 'Ollama', modelId };
    }

    default:
      throw new Error(
        `Provider type "${config.type}" is not yet supported for chat. Supported: anthropic, openai, google, ollama.`
      );
  }
}

/**
 * Error thrown when no LLM provider is configured.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message || 'No LLM provider configured. Go to Settings > Providers to set one up.');
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * Error thrown when a provider's API key is missing.
 */
export class ProviderKeyMissingError extends Error {
  constructor(providerName: string) {
    super(`API key missing for ${providerName}. Update it in Settings > Providers.`);
    this.name = 'ProviderKeyMissingError';
  }
}
