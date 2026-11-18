// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Pure helpers that the Agent Skill pages share. They have no transport.
 */
import type {
  AgentSkillDTO,
  SharedAgentSkillDTO,
} from "@/src/lib/gibson-client/agent-skill-types";

/** Where an Agent Skill came from. */
export type AgentSkillSource = "tenant" | "shared";

const SHORT_DIGEST_HEX = 12;

/** Show a digest as sha256:<first 12 hex characters>. Other text stays as is. */
export function shortDigest(digest: string): string {
  const m = /^(sha256:)([0-9a-f]{64})$/i.exec(digest);
  if (!m) return digest;
  return `${m[1]}${m[2].slice(0, SHORT_DIGEST_HEX)}`;
}

/**
 * The daemon does not tag an entry with its source. A version is "shared" when
 * the operator offers an Agent Skill of the same name and digest and the
 * tenant holds it. Any other version came from a publish of the tenant.
 */
export function agentSkillSource(
  entry: Pick<AgentSkillDTO, "name" | "digest">,
  shared: readonly SharedAgentSkillDTO[],
): AgentSkillSource {
  const hit = shared.some(
    (s) => s.enabled && s.name === entry.name && s.digest === entry.digest,
  );
  return hit ? "shared" : "tenant";
}

/** Format an ISO time for a table cell. An unreadable value shows as is. */
export function formatPublishedAt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
