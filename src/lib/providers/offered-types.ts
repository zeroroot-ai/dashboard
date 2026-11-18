// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The provider types that the wizard offers (gibson#1394).
 *
 * A provider is tested through its route on the model gateway. The daemon
 * makes a route for these types only. Another type is saved, gets no route,
 * and answers "route not ready" for ever, so the wizard does not offer it.
 * Voyage is not a provider type: the gateway does not accept its reply.
 *
 * The list is the same as gatewayProviderType in the daemon
 * (internal/server/daemon/api/server_model_providers_desired.go). A type that
 * the daemon routes later needs one line here.
 */
const OFFERED_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "openai-compatible",
  "bedrock",
  "google",
  "vertex",
]);

/** True when the wizard may offer the type as a new provider. */
export function isOfferedProviderType(type: string): boolean {
  return OFFERED_PROVIDER_TYPES.has(type);
}
