/**
 * Provider capability helpers (E11 BYO-embedder, gibson#810).
 *
 * A provider declares which services it fulfils via the proto
 * `gibson.tenant.v1.Capability` enum (CHAT and/or EMBEDDING). The dashboard
 * works in terms of a small string union (`"chat" | "embedding"`) for ergonomic
 * form state, and converts to/from the proto enum at the wire boundary in
 * gibson-client.ts.
 *
 * Empty capabilities are treated as the legacy chat-only default, mirroring the
 * daemon's interpretation (provider.proto: "Empty implies the legacy chat-only
 * default").
 *
 * This module is intentionally free of any `@/src/gen` (proto) runtime import
 * so it can be used from `'use client'` components without pulling
 * @bufbuild/protobuf / @grpc/grpc-js into the browser bundle. The proto enum
 * values are mirrored as numeric literals (matching provider.proto:
 * CAPABILITY_UNSPECIFIED=0, CAPABILITY_CHAT=1, CAPABILITY_EMBEDDING=2).
 *
 * Pure functions, no daemon/React dependency, so they can be unit tested
 * directly.
 */

import type { ProviderCapability } from '@/src/lib/gibson-client-types';


/** Proto gibson.tenant.v1.Capability enum values, mirrored as literals. */
export const PROTO_CAPABILITY = {
  UNSPECIFIED: 0,
  CHAT: 1,
  EMBEDDING: 2,
} as const;

/** All selectable capabilities, in display order. */
export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  'chat',
  'embedding',
] as const;

/** Human-readable label for a capability. */
export function capabilityLabel(cap: ProviderCapability): string {
  return cap === 'chat' ? 'Chat / completions' : 'Embeddings';
}

/**
 * Convert dashboard capability strings to proto Capability enum values.
 * Unknown/empty input yields an empty array (legacy chat-only default).
 */
export function toProtoCapabilities(caps: readonly ProviderCapability[]): number[] {
  const out: number[] = [];
  for (const c of caps) {
    if (c === 'chat') out.push(PROTO_CAPABILITY.CHAT);
    else if (c === 'embedding') out.push(PROTO_CAPABILITY.EMBEDDING);
  }
  return out;
}

/**
 * Convert proto Capability enum values to dashboard capability strings.
 *
 * An empty proto list is interpreted as chat-only (the legacy default), so the
 * UI always shows at least the chat capability for an existing provider that
 * predates the capabilities field. UNSPECIFIED values are dropped. The result
 * is de-duplicated and ordered per {@link PROVIDER_CAPABILITIES}.
 */
export function fromProtoCapabilities(caps: readonly number[]): ProviderCapability[] {
  const set = new Set<ProviderCapability>();
  for (const c of caps) {
    if (c === PROTO_CAPABILITY.CHAT) set.add('chat');
    else if (c === PROTO_CAPABILITY.EMBEDDING) set.add('embedding');
  }
  if (set.size === 0) set.add('chat');
  return PROVIDER_CAPABILITIES.filter((c) => set.has(c));
}

/** True when the capability list includes embedding support. */
export function hasEmbeddingCapability(caps: readonly ProviderCapability[]): boolean {
  return caps.includes('embedding');
}

/** True when the capability list includes chat support. */
export function hasChatCapability(caps: readonly ProviderCapability[]): boolean {
  return caps.includes('chat');
}

/**
 * Does the given set of configured providers include at least one that serves
 * embeddings? Used to gate onboarding completion and to decide whether to show
 * the "configure an embedding provider" prompt on vector features.
 */
export function anyProviderServesEmbedding(
  providers: readonly { capabilities?: readonly ProviderCapability[] }[],
): boolean {
  return providers.some((p) => hasEmbeddingCapability(p.capabilities ?? []));
}
