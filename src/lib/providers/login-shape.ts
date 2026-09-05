/**
 * Login shapes for bank members (gibson#1706, ADR-0019 decision 4).
 *
 * A bank member is a Claude Code process. It authenticates to Anthropic in
 * one of five shapes: a person's subscription, the tenant's Anthropic API
 * key, or a third-party route on the tenant's own cloud account (Amazon
 * Bedrock, Google Vertex AI, Microsoft Foundry). Every shape except the
 * subscription reads its credential from one tenant provider configuration,
 * so the provider type of a configuration decides which shape it can serve.
 *
 * The strings here match `gibson.bank.v1.LoginShape` in lower case, and the
 * daemon's `componentcatalog.LoginShape*` constants, so a value round-trips
 * through the wire without a translation table.
 */

/** A login shape a provider configuration can serve. */
type ProviderLoginShape = "anthropic_api_key" | "bedrock" | "vertex" | "foundry";

const SHAPE_BY_PROVIDER_TYPE: Readonly<Record<string, ProviderLoginShape>> = {
  anthropic: "anthropic_api_key",
  bedrock: "bedrock",
  vertex: "vertex",
  foundry: "foundry",
};

const SHAPE_LABEL: Readonly<Record<ProviderLoginShape, string>> = {
  anthropic_api_key: "Anthropic API key",
  bedrock: "Amazon Bedrock",
  vertex: "Google Vertex AI",
  foundry: "Microsoft Foundry",
};

/**
 * Returns the login shape a provider configuration of `type` serves, or null
 * when bank members cannot run on that provider type.
 */
export function loginShapeForProviderType(type: string): ProviderLoginShape | null {
  return SHAPE_BY_PROVIDER_TYPE[type] ?? null;
}

/** Human-facing name of a login shape. */
export function loginShapeLabel(shape: ProviderLoginShape): string {
  return SHAPE_LABEL[shape];
}

/**
 * One sentence for the provider picker: what a configuration of this type
 * gives a bank, beyond chat and embeddings. Null when it gives nothing.
 */
export function loginShapeHint(type: string): string | null {
  const shape = loginShapeForProviderType(type);
  if (!shape) return null;
  return `Bank members can run Claude Code on this configuration (${SHAPE_LABEL[shape]} login shape).`;
}
