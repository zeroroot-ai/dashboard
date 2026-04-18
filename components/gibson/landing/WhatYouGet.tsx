const items = [
  {
    term: "ADK",
    body: "Agent, Tool, and Plugin contracts. A single Harness wires LLMs, memory, tools, and the knowledge graph. Go today — Rust and Python in the works.",
  },
  {
    term: "gibson-cli",
    body: "Scaffolds projects, installs agents and tools, launches missions, inspects graph state. The client you script against api.zero-day.ai.",
  },
  {
    term: "DAG missions",
    body: "A mission is a parameterized YAML DAG of agent + tool steps targeting one system. The orchestrator runs it in an Observe → Think → Act → Recall → Reflect loop. Pausable, resumable, checkpointed.",
  },
  {
    term: "Knowledge graph",
    body: "Every discovery — hosts, ports, findings, techniques, attack chains — lands in Neo4j under a YAML-driven taxonomy with CEL-validated schemas. What one agent learns, the next one starts from.",
  },
  {
    term: "RBAC",
    body: "OpenFGA authz on every RPC. Agents, users, tenants, and components each have scoped permissions — your PR-review bot can't touch production, your red-team agent can't touch ServiceNow. Every action audited.",
  },
  {
    term: "Observability",
    body: "Langfuse captures every prompt, response, tool call, and graph write. Replay any mission step-by-step — see why the agent chose Action X, what each step cost, and where the reasoning went sideways. Tagged per mission, agent, tenant.",
  },
] as const;

export function WhatYouGet() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-20 md:py-24">
      <h2 className="mb-10 font-mono text-sm md:text-base">
        <span className="text-green-400/50 select-none">$ </span>
        <span className="text-green-300">cat what-you-get.md</span>
      </h2>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
        {items.map(({ term, body }) => (
          <div key={term} className="border-l border-green-500/30 pl-4">
            <dt className="mb-1 font-mono text-base md:text-lg text-green-300">
              {term}
            </dt>
            <dd className="text-sm md:text-base leading-relaxed text-green-50/85">
              {body}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
