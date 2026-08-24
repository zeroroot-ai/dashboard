// Illegal: adds a CONNECTOR recipient class to the grants inspector.
// Capability grants are minted to principals; a connector is only ever
// the object of a grant (ADR-0067), never a recipient.

declare const RC: { CONNECTOR: number };

const RECIPIENT_CLASS_LABELS: Record<number, string> = {
  0: "All",
  1: "Agent",
  2: "Tool",
  3: "Plugin",
  [RC.CONNECTOR]: "Connector",
};

export function label(rc: number): string {
  return RECIPIENT_CLASS_LABELS[rc] ?? "Unknown";
}
