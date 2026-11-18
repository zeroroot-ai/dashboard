// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The RPC that the Agent Skill pages and the nav entry gate on. Each
 * AgentSkillService RPC has the "admin" relation on the tenant, so one RPC
 * stands for the whole surface. The nav entry, the pages and the tests all
 * import this name, so the name has one definition.
 */
export const AGENT_SKILL_PAGE_METHOD =
  "/gibson.tenant.v1.AgentSkillService/ListAgentSkills";
