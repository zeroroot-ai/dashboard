import type { DaemonProviderRecord } from '@/src/lib/gibson-client';
import type { ProviderConfig } from '@/src/types/provider';

/**
 * Maps a daemon-side ProviderRecord to the dashboard's ProviderConfig shape.
 *
 * DaemonProviderRecord is the wire shape from the daemon proto (enabled, no
 * displayName, no version). ProviderConfig is what the dashboard components
 * expect (isEnabled, displayName, version). This is the single translation
 * point between the two.
 */
export function toProviderConfig(r: DaemonProviderRecord): ProviderConfig {
  return {
    name: r.name,
    displayName: r.name,
    type: r.type,
    defaultModel: r.defaultModel || undefined,
    isDefault: r.isDefault,
    isEnabled: r.enabled,
    credentialsMasked: r.credentialsMasked,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    version: 0,
    capabilities: r.capabilities,
    defaultEmbeddingModel: r.defaultEmbeddingModel || undefined,
  };
}
