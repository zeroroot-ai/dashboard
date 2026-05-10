/**
 * draft-load-mapper — pre-rewrite drafts saved before
 * mission-dashboard-rewrite carry fields the daemon never honored
 * (mission.executionMode, mission.errorHandling.*,
 * RetryConfig subset, guardrails.confirmationRequired[]). When
 * loading those drafts after the rewrite, this module silently
 * drops the now-removed fields so the form opens cleanly.
 *
 * Per design.md Component 9 + Requirements 2 AC 2 + 7 AC 4: no
 * user-facing warning. The dropped fields were never honored by
 * the daemon, so silently filtering them is a strict improvement.
 *
 * The mapper is shape-tolerant by design — it accepts arbitrary
 * legacy JSON and emits a known-good `LoadedDraft`. Failure to
 * parse any individual nested field is non-fatal; the field
 * defaults instead.
 *
 * Spec: mission-dashboard-rewrite Requirements 2 AC 2 + 7 AC 4
 *       + Task 17.
 */

import type { MissionDefinition } from "@/src/gen/gibson/mission/v1/mission_definition_pb";
import type { MissionConstraints } from "@/src/gen/gibson/daemon/v1/daemon_pb";

/** Fields removed by the rewrite; documented for grep-ability. */
export const REMOVED_LEGACY_FIELDS = [
  "mission.executionMode",
  "mission.errorHandling",
  "mission.errorHandling.retryPolicy",
  "mission.errorHandling.fallbackStrategy",
  "mission.steps[].retry (RetryConfig subset)",
  "guardrails.confirmationRequired",
  "guardrails.confirmationRequired[]",
] as const;

export interface LoadedDraft {
  /** Best-effort reconstruction of the new MissionDefinition shape. */
  definition: Partial<MissionDefinition>;
  /** Best-effort reconstruction of the new MissionConstraints shape. */
  constraints: Partial<MissionConstraints>;
  /**
   * UI-only fields the legacy draft carried. Preserved so the
   * editor can restore the user's WIP on reopen.
   */
  ui: {
    activeTab?: string;
    draftId?: string | null;
    sourceTemplateId?: string | null;
    isValid?: boolean;
    isDirty?: boolean;
    validationMessages?: Array<{
      fieldPath: string;
      severity: "error" | "warning";
      message: string;
    }>;
  };
  /**
   * Field paths that were present in the legacy draft but are now
   * dropped. Surfaced for telemetry / debugging — never shown to
   * the user.
   */
  droppedFields: string[];
}

/**
 * Coerces an arbitrary legacy draft payload (parsed JSON) into
 * the new shape. The legacy payload is opaque; this function does
 * shape-tolerant extraction.
 */
export function loadLegacyDraft(legacy: unknown): LoadedDraft {
  const dropped: string[] = [];
  const draft: LoadedDraft = {
    definition: {},
    constraints: {},
    ui: {},
    droppedFields: dropped,
  };

  if (!legacy || typeof legacy !== "object") {
    return draft;
  }
  const obj = legacy as Record<string, unknown>;

  // The legacy MissionCreationState held a `mission` field for the
  // mission-shaped data; some older drafts use the same shape at
  // the top level.
  const missionRaw = (obj.mission ?? obj) as Record<string, unknown>;

  if (typeof missionRaw.name === "string") {
    draft.definition.name = missionRaw.name;
  }
  if (typeof missionRaw.description === "string") {
    draft.definition.description = missionRaw.description;
  }
  if (typeof missionRaw.version === "string") {
    draft.definition.version = missionRaw.version;
  }
  if (typeof missionRaw.targetRef === "string") {
    draft.definition.targetRef = missionRaw.targetRef;
  } else if (typeof missionRaw.target_ref === "string") {
    draft.definition.targetRef = missionRaw.target_ref as string;
  }

  // executionMode + errorHandling.* are explicitly dropped.
  if ("executionMode" in missionRaw) {
    dropped.push("mission.executionMode");
  }
  if ("errorHandling" in missionRaw) {
    dropped.push("mission.errorHandling");
  }

  // Steps survive — but per-step `retry` (the RetryConfig subset)
  // gets re-mapped onto the proto RetryPolicy at form-load time;
  // we leave it as opaque here for the form's own coercion.
  if (Array.isArray(missionRaw.steps) || typeof missionRaw.nodes === "object") {
    // legacy step shape preserved as part of the definition; the
    // form components handle the per-step rebind.
    draft.definition = {
      ...draft.definition,
      // Defensive: cast through unknown — protojson decode happens
      // in the form layer once it knows the live shape.
      ...(missionRaw as object),
    };
  }

  // Constraints — pre-rewrite drafts may have flat values OR a
  // nested `constraints` block.
  const constraintsRaw = (obj.constraints ?? {}) as Record<string, unknown>;
  if (typeof constraintsRaw.maxDurationSeconds === "number") {
    draft.constraints.maxDurationSeconds =
      constraintsRaw.maxDurationSeconds;
  }
  if (typeof constraintsRaw.maxFindings === "number") {
    draft.constraints.maxFindings = constraintsRaw.maxFindings;
  }
  if (typeof constraintsRaw.maxTokens === "number") {
    draft.constraints.maxTokens = constraintsRaw.maxTokens;
  }
  if (typeof constraintsRaw.maxTurnsPerAgent === "number") {
    draft.constraints.maxTurnsPerAgent = constraintsRaw.maxTurnsPerAgent;
  }
  if (typeof constraintsRaw.maxTokensPerCall === "number") {
    draft.constraints.maxTokensPerCall = constraintsRaw.maxTokensPerCall;
  }
  // Guardrails surface — confirmationRequired explicitly dropped.
  const guardrails = (obj.guardrails ?? {}) as Record<string, unknown>;
  if ("confirmationRequired" in guardrails) {
    dropped.push("guardrails.confirmationRequired");
  }
  if ("maxTokensPerCall" in guardrails) {
    // Legacy lifted into constraints if not already present.
    if (
      typeof guardrails.maxTokensPerCall === "number" &&
      draft.constraints.maxTokensPerCall === undefined
    ) {
      draft.constraints.maxTokensPerCall =
        guardrails.maxTokensPerCall as number;
    }
  }

  // UI state — best-effort preservation.
  const uiRaw = (obj.ui ?? {}) as Record<string, unknown>;
  if (typeof uiRaw.activeTab === "string") draft.ui.activeTab = uiRaw.activeTab;
  if (typeof uiRaw.draftId === "string" || uiRaw.draftId === null) {
    draft.ui.draftId = uiRaw.draftId as string | null;
  }
  if (
    typeof uiRaw.sourceTemplateId === "string" ||
    uiRaw.sourceTemplateId === null
  ) {
    draft.ui.sourceTemplateId = uiRaw.sourceTemplateId as string | null;
  }

  return draft;
}
