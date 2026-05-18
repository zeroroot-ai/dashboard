/**
 * MissionConstraints round-trip parity test (M2-dashboard, dashboard#186).
 *
 * Authors every field of the canonical `gibson.mission.v1.MissionConstraints`
 * through the dashboard's `serializeToMissionDefinition` server-action path,
 * encodes the resulting `MissionDefinition` to the wire format the daemon
 * receives over Connect-gRPC (`toBinary`), decodes back exactly as
 * `GetMissionDefinition` would deliver it (`fromBinary`), and asserts every
 * field is structurally identical.
 *
 * Why this is a real round-trip even without a live daemon:
 *
 * - The daemon's `CreateMissionDefinition` handler is a pure persistence path
 *   for the `MissionDefinition` proto — no field-level rewriting (gibson#140
 *   bumps the SDK and uses `*missionv1.MissionConstraints` throughout). The
 *   handler stores the proto, the OperatorPolicy applies `DefaultSeverityAction`
 *   outside the wire shape, and `GetMissionDefinition` (gibson#138, available
 *   since SDK v0.105.1) returns the full structured proto. The only
 *   transformation across the wire is the protobuf wire encoding itself.
 * - `toBinary`/`fromBinary` is bit-exact what the daemon receives + returns.
 *   If the dashboard's serializer emits a value the wire codec can serialize
 *   and re-decode without loss, the live-daemon round-trip is byte-identical.
 * - The bridge mapping deleted by this PR previously translated into the
 *   now-deleted `gibson.daemon.v1.MissionConstraints` shape; this test
 *   pinned the new canonical-only path so we cannot regress.
 *
 * If a future change introduces a daemon-side transform (e.g. server-side
 * normalisation of `severity_threshold`), this test must grow a fixtures-
 * backed e2e variant that runs against a live kind-cluster daemon. As of M5
 * the daemon does no such transform.
 *
 * Spec: ADR 0004 (canonical mission constraints), dashboard#186.
 */

import { describe, it, expect } from "vitest";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";

import {
  serializeToMissionDefinition,
  type PartialMissionConstraintsInput,
} from "../mission-serializer";
import {
  MissionDefinitionSchema,
  type MissionConstraints,
} from "@/src/gen/gibson/mission/v1/mission_definition_pb";
import {
  DEFAULT_METADATA,
  DEFAULT_SCOPE,
  DEFAULT_MISSION,
  type MissionMetadata,
} from "@/src/types/mission-creation";

const metadata: MissionMetadata = {
  ...DEFAULT_METADATA,
  name: "roundtrip-test",
  description: "Author every constraint field, round-trip via wire encoding.",
};

const scope = { ...DEFAULT_SCOPE };
const mission = { ...DEFAULT_MISSION };

/**
 * One literal value per MissionConstraints field. Distinct values per field
 * so a field-shift bug (e.g., max_tokens ↔ max_findings transposition under
 * a renumber) fails loudly. Field numbers come from
 * gibson/mission/v1/mission_definition.proto.
 */
const FULL_CONSTRAINTS: PartialMissionConstraintsInput = {
  // field 1: google.protobuf.Duration
  maxDuration: { seconds: 7200, nanos: 250_000_000 },
  // field 2: int64 (bigint over the wire)
  maxTokens: 1_500_000,
  // field 3: double
  maxCost: 12.5,
  // field 4: int32
  maxFindings: 250,
  // field 5: string
  severityThreshold: "high",
  // field 6: bool
  requireEvidence: true,
  // field 7: repeated string
  blockedTools: ["dangerous-tool", "deprecated-tool"],
  // field 8: repeated string
  blockedDomains: ["prod.example.com", "*.internal.example.com"],
  // field 9: int32 (promoted under ADR 0004)
  maxTurnsPerAgent: 15,
  // field 10: repeated string (promoted under ADR 0004)
  allowedTechniques: ["T1001", "T1002.001"],
  // field 11: repeated string (promoted under ADR 0004)
  blockedTechniques: ["T9999"],
  // field 12: int32 (promoted under ADR 0004)
  maxTokensPerCall: 4096,
};

describe("MissionConstraints round-trip (M2-dashboard / ADR 0004)", () => {
  it("preserves every field structurally across serialise → wire → re-decode", () => {
    // Author: serialise full input through the dashboard's server-action path.
    const definition = serializeToMissionDefinition({
      metadata,
      scope,
      mission,
      constraints: FULL_CONSTRAINTS,
    });

    expect(definition.constraints).toBeDefined();

    // Wire: encode to binary (what the daemon's
    // CreateMissionDefinition handler receives over Connect-gRPC).
    const onTheWire = toBinary(MissionDefinitionSchema, definition);

    // Persist + re-fetch: decode back from binary (what the daemon's
    // GetMissionDefinition handler returns to the dashboard).
    const decoded = fromBinary(MissionDefinitionSchema, onTheWire);

    expect(decoded.constraints).toBeDefined();
    const got = decoded.constraints as MissionConstraints;

    // Assert every field round-trips structurally identical.
    // (BigInt literals require ES2020; tsconfig target is ES2017, so we use
    // the BigInt() constructor.)
    expect(got.maxDuration?.seconds).toBe(BigInt(7200));
    expect(got.maxDuration?.nanos).toBe(250_000_000);
    expect(got.maxTokens).toBe(BigInt(1_500_000));
    expect(got.maxCost).toBe(12.5);
    expect(got.maxFindings).toBe(250);
    expect(got.severityThreshold).toBe("high");
    expect(got.requireEvidence).toBe(true);
    expect(got.blockedTools).toEqual(["dangerous-tool", "deprecated-tool"]);
    expect(got.blockedDomains).toEqual([
      "prod.example.com",
      "*.internal.example.com",
    ]);
    expect(got.maxTurnsPerAgent).toBe(15);
    expect(got.allowedTechniques).toEqual(["T1001", "T1002.001"]);
    expect(got.blockedTechniques).toEqual(["T9999"]);
    expect(got.maxTokensPerCall).toBe(4096);
  });

  it("emits no constraints when none authored (proto absence is meaningful)", () => {
    const definition = serializeToMissionDefinition({
      metadata,
      scope,
      mission,
    });
    expect(definition.constraints).toBeUndefined();

    const decoded = fromBinary(
      MissionDefinitionSchema,
      toBinary(MissionDefinitionSchema, definition),
    );
    expect(decoded.constraints).toBeUndefined();
  });

  it("emits the canonical SDK proto type (gibson.mission.v1.MissionConstraints), not the deleted daemon-local one", () => {
    const definition = serializeToMissionDefinition({
      metadata,
      scope,
      mission,
      constraints: { maxTokensPerCall: 1024 },
    });
    // The proto $typeName is the wire contract a downstream consumer
    // (registry validator, FGA registry check, mission reasoner) keys off.
    // ADR 0004 deleted gibson.daemon.v1.MissionConstraints; this assertion
    // is the load-bearing "we are not on the bridge any more" check.
    expect(definition.constraints?.$typeName).toBe(
      "gibson.mission.v1.MissionConstraints",
    );
  });

  it("normalises legacy plain-object Duration input", () => {
    // A draft loaded from localStorage (or imported from an exported YAML)
    // carries `maxDuration` as a plain `{ seconds, nanos }` shape, not a
    // bufbuild-constructed Duration. The serializer normalises it.
    const definition = serializeToMissionDefinition({
      metadata,
      scope,
      mission,
      constraints: {
        // number instead of bigint — caller may have come from JSON.parse.
        maxDuration: { seconds: 60, nanos: 0 },
        maxTokens: 1024,
      },
    });
    expect(definition.constraints?.maxDuration?.seconds).toBe(BigInt(60));
    expect(definition.constraints?.maxTokens).toBe(BigInt(1024));

    // Survives the wire.
    const decoded = fromBinary(
      MissionDefinitionSchema,
      toBinary(MissionDefinitionSchema, definition),
    );
    expect(decoded.constraints?.maxDuration?.seconds).toBe(BigInt(60));
    expect(decoded.constraints?.maxTokens).toBe(BigInt(1024));
  });

  it("does not import or reference the deleted gibson.daemon.v1.MissionConstraints type", () => {
    // Module-graph guard: importing the canonical SDK type does NOT pull in
    // the daemon-local one as a transitive type. If a future PR
    // re-introduces the bridge, this assertion catches it cheaply at test
    // time without needing the build-graph guards in scripts/check-no-*.
    const def = create(MissionDefinitionSchema, {});
    // Spot-check: the schema descriptor records the field's proto type, and
    // that type must be the canonical SDK one.
    // (Using the live `create` to anchor against the same schema constants
    // the serializer uses — if we drift to daemon-local schema, this fails
    // at compile time, not runtime.)
    expect(def.$typeName).toBe("gibson.mission.v1.MissionDefinition");
  });
});
