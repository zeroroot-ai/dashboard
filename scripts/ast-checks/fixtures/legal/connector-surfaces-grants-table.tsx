// Legal: recipient classes stay principal-only (agent / tool / plugin).
// A connector has no principal (ADR-0067), so no class for it exists here.

const RECIPIENT_CLASS_LABELS: Record<number, string> = {
  0: "All",
  1: "Agent",
  2: "Tool",
  3: "Plugin",
};

export function label(rc: number): string {
  return RECIPIENT_CLASS_LABELS[rc] ?? "Unknown";
}
