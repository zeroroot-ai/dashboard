// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The RPC that the outside agent pages and the nav entry gate on. Each
 * OutsideAgentService RPC has the "admin" relation on the tenant, so one RPC
 * stands for the whole surface.
 */
export const OUTSIDE_AGENT_PAGE_METHOD =
  "/gibson.tenant.v1.OutsideAgentService/ListOutsideAgents";
