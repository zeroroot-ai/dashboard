// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The RPC that the inbound missions page and the nav entry gate on. Each
 * InboundMissionService RPC has the "admin" relation on the tenant, so one RPC
 * stands for the whole surface.
 */
export const INBOUND_MISSION_PAGE_METHOD =
  "/gibson.tenant.v1.InboundMissionService/ListInboundMissions";
