// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Inbound mission data-transfer objects (epic gibson#1367, gibson#1408). A
 * published definition is a mission definition that an outside A2A client can
 * start under one agent name. Plain JSON shapes for the browser, with no
 * transport.
 */

/** One published definition of the tenant. */
export interface InboundMissionDTO {
  /** The agent name that the outside client addresses. */
  agent: string;
  missionDefinitionId: string;
  /** The ids of the approved targets. */
  targetIds: string[];
  /** The subject of the admin who published it. */
  publishedBy: string;
  /** ISO 8601 time, or an empty string. */
  createdAt: string;
  /**
   * True when the mission definition or an approved target changed after the
   * publish. The daemon refuses each inbound call until an admin publishes again.
   */
  stale: boolean;
  /** What changed. Empty when `stale` is false. */
  staleReason: string;
}

/** One name and id, for a picker. */
export interface InboundOptionDTO {
  id: string;
  name: string;
}

/** The new identity of one caller. The token is shown one time. */
export interface InboundCallerIdentityDTO {
  /**
   * The typed principal id, for example "agent_principal:<id>". The caller
   * grant takes this value unchanged.
   */
  principalId: string;
  name: string;
  bootstrapToken: string;
  gibsonUrl: string;
}

/** One caller of a published definition. The name is empty when the identity list does not hold it. */
export interface InboundCallerDTO {
  /** The typed principal id, for example "agent_principal:<id>". */
  identityId: string;
  name: string;
}

/** The step of the caller flow that failed. */
export type InboundFlowStep = "identity" | "publish" | "grant";

/**
 * The result of a flow that makes a new caller. A failure states each thing
 * that the flow made before it stopped, so no half state stays hidden.
 */
export type InboundCallerFlowResult =
  | {
      ok: true;
      caller: InboundCallerDTO;
      credentials: { bootstrapToken: string; gibsonUrl: string };
    }
  | {
      ok: false;
      error: string;
      code?: string;
      /** Absent when the flow refused the input and called nothing. */
      failedStep?: InboundFlowStep;
      /**
       * The identity that the flow made. `removed` is true when the flow revoked
       * it again. `revokeNote` is a fixed text, set when the daemon blocked the
       * access of the identity and did not finish the cleanup of the revoke.
       */
      identity?: InboundCallerDTO & { removed: boolean; revokeNote?: string };
      /** True when the definition is published after the failure. */
      published?: boolean;
    };
