/**
 * Canonical mission creation state — proto-typed.
 *
 * This is the rewrite target shape from the
 * mission-dashboard-rewrite spec. The existing
 * `mission-creation.ts` file holds the legacy
 * MissionCreationState; this file defines the new shape that
 * form components and the Server Action consume after the
 * rewrite. The legacy file is kept alongside until Task 3's
 * full migration completes (hand-rolled MissionConfig
 * removal), so existing callers continue to compile through
 * the migration window.
 *
 * Key invariants:
 * - `definition` is the generated `*missionv1.MissionDefinition`.
 * - `constraints` is the generated `*daemonv1.MissionConstraints`.
 * - `ui` is purely UI state — never crosses the wire.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 + Task 3.
 */

import type { MissionConstraints } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import type { MissionDefinition } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

export type ActiveTab = "scope" | "steps" | "constraints" | "guardrails";

export interface ValidationMessage {
  fieldPath: string;
  severity: "error" | "warning";
  message: string;
}

export interface UIState {
  activeTab: ActiveTab;
  isDirty: boolean;
  isValid: boolean;
  validationMessages: ValidationMessage[];
  draftId: string | null;
  sourceTemplateId: string | null;
}

export interface MissionCreationStateV2 {
  /** The mission's structural schema — generated proto type. */
  definition: MissionDefinition;
  /** Mission instance constraints — generated proto type. */
  constraints: MissionConstraints;
  /** UI state; never crosses the wire to the daemon. */
  ui: UIState;
}

/** Canonical empty MissionDefinition for new missions. */
export const emptyDefinition: MissionDefinition = {
  $typeName: "gibson.mission.v1.MissionDefinition" as const,
  id: "",
  name: "",
  description: "",
  version: "1.0.0",
  targetRef: "",
  nodes: {},
  edges: [],
  entryPoints: [],
  exitPoints: [],
  metadata: {},
  dependencies: undefined,
  source: "",
  installedAt: undefined,
  createdAt: undefined,
};

/** Canonical empty MissionConstraints. */
export const emptyConstraints: MissionConstraints = {
  $typeName: "gibson.daemon.v1.MissionConstraints" as const,
  maxDurationSeconds: 0,
  maxFindings: 0,
  maxTokens: 0,
  maxTurnsPerAgent: 0,
  allowedTechniques: [],
  blockedTechniques: [],
  maxTokensPerCall: 0,
};

/** Canonical empty UIState. */
export const emptyUIState: UIState = {
  activeTab: "scope",
  isDirty: false,
  isValid: false,
  validationMessages: [],
  draftId: null,
  sourceTemplateId: null,
};

/** Canonical empty MissionCreationStateV2. */
export const emptyMissionCreationStateV2: MissionCreationStateV2 = {
  definition: emptyDefinition,
  constraints: emptyConstraints,
  ui: emptyUIState,
};
