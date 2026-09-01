/**
 * Client-safe view of banks and members (gibson#1706, ADR-0019).
 *
 * The API routes map `gibson.bank.v1` protos to these shapes, so a client
 * component never imports a proto binding. Enums travel as lower-case names
 * that match the proto value without its prefix (`LOGIN_SHAPE_BEDROCK` is
 * `bedrock`), which is also what the daemon's manifest names the shape.
 *
 * The member state words match the published docs: idle, busy N/cap, needs
 * sign-in, draining, dead.
 */

/** How a member authenticates to Anthropic. */
export type LoginShapeName =
  | "subscription"
  | "anthropic_api_key"
  | "bedrock"
  | "vertex"
  | "foundry";

/** What a bank does with a job when no member has a free slot. */
export type SpillPolicyName = "queue" | "ephemeral";

/** Where a member is in its life. `unknown` is a value this build does not know. */
export type MemberStateName =
  | "launching"
  | "needs_sign_in"
  | "idle"
  | "busy"
  | "draining"
  | "dead"
  | "unknown";

/** Who owns a bank or opened a job. */
export interface PrincipalView {
  kind: "user" | "tenant" | "component" | "service" | "unknown";
  id: string;
}

export interface BankView {
  id: string;
  tenantId: string;
  owner: PrincipalView;
  name: string;
  desiredCount: number;
  loginShape: LoginShapeName;
  providerConfigName: string;
  agentName: string;
  model: string;
  maxJobsInFlight: number;
  /** Idle limit for a job in seconds. Null means the daemon default. */
  staleLimitSeconds: number | null;
  spillPolicy: SpillPolicyName;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MemberView {
  id: string;
  bankId: string;
  missionId: string;
  missionRunId: string;
  agentRunId: string;
  sandboxId: string;
  state: MemberStateName;
  jobsInFlight: number;
  cap: number;
  activeJobIds: string[];
  claudeVersion: string;
  lastHeartbeat: string | null;
}

export const LOGIN_SHAPE_LABEL: Readonly<Record<LoginShapeName, string>> = {
  subscription: "Subscription (the owner signs in inside the sandbox)",
  anthropic_api_key: "Anthropic API key",
  bedrock: "Amazon Bedrock",
  vertex: "Google Vertex AI",
  foundry: "Microsoft Foundry",
};

export const LOGIN_SHAPES: readonly LoginShapeName[] = [
  "subscription",
  "anthropic_api_key",
  "bedrock",
  "vertex",
  "foundry",
];

export const SPILL_POLICY_LABEL: Readonly<Record<SpillPolicyName, string>> = {
  queue: "Queue the job until a member is free",
  ephemeral: "Launch a one-shot instance for the job",
};

export const SPILL_POLICIES: readonly SpillPolicyName[] = ["queue", "ephemeral"];

/** True when the shape reads its credential from a provider configuration. */
export function shapeNeedsProviderConfig(shape: LoginShapeName): boolean {
  return shape !== "subscription";
}

/**
 * The member state chip text, in the words the docs use. A busy member shows
 * how many slots it holds out of its cap.
 */
export function memberStateLabel(
  m: Pick<MemberView, "state" | "jobsInFlight" | "cap">,
): string {
  switch (m.state) {
    case "idle":
      return "idle";
    case "busy":
      return `busy ${m.jobsInFlight}/${m.cap}`;
    case "needs_sign_in":
      return "needs sign-in";
    case "draining":
      return "draining";
    case "dead":
      return "dead";
    case "launching":
      return "launching";
    default:
      return "unknown";
  }
}

/** Owner text for a list row. */
export function ownerLabel(owner: PrincipalView, myUserId: string | null): string {
  if (owner.kind === "tenant") return "Tenant";
  if (owner.kind === "user") return owner.id === myUserId ? "Me" : `User ${owner.id}`;
  return owner.id;
}

/** Stale limit text: `45 min`, `2 h`, or `daemon default`. */
export function staleLimitLabel(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "daemon default";
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${Math.round(seconds / 60)} min`;
}
