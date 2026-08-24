// Illegal: a permissions page below a connectors route segment. A
// connector has no principal (ADR-0067), so no such surface may exist.
export default function Page() {
  return null;
}
