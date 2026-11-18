// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Agent Skill data-transfer objects (epic gibson#1364).
 *
 * Plain JSON shapes that the Agent Skill actions return to the browser. The
 * daemon proto messages never cross this boundary. The server client
 * (./agent-skills.ts) makes them. The client components render them. This
 * module has no transport, so a client component may import it.
 */

/** One published version of an Agent Skill. */
export interface AgentSkillDTO {
  name: string;
  /** The OCI image digest, in the form sha256:<hex>. */
  digest: string;
  /** The digest reference that the publisher gave. */
  reference: string;
  description: string;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  /** ISO 8601 time, or an empty string when the daemon sent none. */
  publishedAt: string;
  /** True for the newest publish of the name. */
  current: boolean;
}

/** One file of a version, besides SKILL.md. */
interface AgentSkillFileDTO {
  path: string;
  sizeBytes: number;
}

/** One version with its body and its file list. */
export interface AgentSkillDetailDTO {
  entry: AgentSkillDTO;
  /** The text of SKILL.md after the frontmatter. It is untrusted text. */
  body: string;
  files: AgentSkillFileDTO[];
}

/** One Agent Skill that the operator offers to each tenant. */
export interface SharedAgentSkillDTO {
  name: string;
  description: string;
  digest: string;
  /** True when the tenant holds this digest. */
  enabled: boolean;
}

/** What a grant names. */
export type AgentSkillSubjectKindDTO = "agent" | "mission";
