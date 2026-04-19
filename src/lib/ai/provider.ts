/**
 * AI Provider Factory
 *
 * Thin factory that returns a GibsonLLMAdapter for a named provider config.
 * Credentials never cross into the dashboard process — the adapter proxies
 * every call to the Gibson daemon over gRPC, which holds the decrypted
 * credential, constructs the upstream langchaingo provider, makes the call,
 * and streams back.
 *
 * Design: spec 25 (`25-daemon-driven-provider-config`) §6.
 */
import 'server-only';
import { GibsonLLMAdapter } from './gibson-llm-adapter';
import type { LanguageModelV2 } from '@ai-sdk/provider';

/**
 * Return a Vercel AI SDK LanguageModel for the named provider config.
 *
 * The returned adapter proxies every call to the Gibson daemon over
 * gRPC. Credentials never cross into the dashboard process — the
 * daemon holds the decrypted credential, constructs the upstream
 * langchaingo provider, makes the call, and streams back.
 *
 * @param providerName - name of a configured provider (from CreateProvider)
 * @param opts - optional userId/tenantId; defaults to server session
 */
export function resolveProvider(
  providerName: string,
  opts?: { userId?: string; tenantId?: string },
): LanguageModelV2 {
  if (!providerName) {
    throw new Error('resolveProvider: providerName is required');
  }
  if (providerName === 'custom') {
    throw new Error(
      'resolveProvider: "custom" provider type is not resolvable from the dashboard; ' +
        'see docs/byok-providers.md for operator-side configuration.',
    );
  }
  return new GibsonLLMAdapter(providerName, opts?.userId, opts?.tenantId);
}
