const items = [
  {
    term: "ADK",
    slug: "adk",
    body: "Agent, Tool, and Plugin contracts. A single Harness wires LLMs, memory, tools, and the knowledge graph. Go today — Rust and Python in the works.",
  },
  {
    term: "gibson CLI",
    slug: "gibson-cli",
    body: "Scaffolds projects, installs agents and tools, launches missions, inspects graph state. The client you script against api.zeroroot.ai.",
  },
  {
    term: "DAG missions",
    slug: "missions",
    body: "A mission is a CUE-typed DAG of agent + tool nodes wired by edges and parameterized by target. CUE catches misconfigurations at submit time — wrong agent name, missing field, bad enum — before the orchestrator ever runs the Observe → Think → Act → Recall → Reflect loop. Pausable, resumable, checkpointed.",
  },
  {
    term: "Knowledge graph",
    slug: "knowledge-graph",
    body: "Every discovery — hosts, ports, findings, techniques, attack chains — lands in the platform's knowledge graph under a YAML-driven taxonomy with CEL-validated schemas. What one agent learns, the next one starts from.",
  },
  {
    term: "RBAC",
    slug: "rbac",
    body: "Agents, users, teams, and components each have scoped permissions — your PR-review bot can't touch production, your red-team agent can't touch ServiceNow. Every action audited.",
  },
  {
    term: "Observability",
    slug: "observability",
    body: "Gibson Traces captures every prompt, response, tool call, and graph write. Replay any mission step-by-step — see why the agent chose Action X, what each step cost, and where the reasoning went sideways. Tagged per mission, agent, team.",
  },
] as const;

const sigils: Record<string, React.ReactNode> = {
  adk: (
    <>
      <rect x="6" y="14" width="24" height="22" rx="1" />
      <rect x="14" y="10" width="28" height="22" rx="1" />
      <line x1="14" y1="20" x2="42" y2="20" />
      <line x1="20" y1="14" x2="22" y2="14" />
    </>
  ),
  "gibson-cli": (
    <>
      <rect x="4" y="9" width="40" height="30" rx="1" />
      <line x1="4" y1="16" x2="44" y2="16" />
      <circle cx="8" cy="12.5" r="0.8" />
      <circle cx="11" cy="12.5" r="0.8" />
      <circle cx="14" cy="12.5" r="0.8" />
      <polyline points="10,24 16,29 10,34" />
      <line x1="20" y1="34" x2="34" y2="34" />
    </>
  ),
  missions: (
    <>
      <circle cx="10" cy="12" r="3" />
      <circle cx="38" cy="12" r="3" />
      <circle cx="24" cy="24" r="3" />
      <circle cx="10" cy="36" r="3" />
      <circle cx="38" cy="36" r="3" />
      <line x1="13" y1="13" x2="22" y2="23" />
      <line x1="35" y1="13" x2="26" y2="23" />
      <line x1="22" y1="25" x2="13" y2="35" />
      <line x1="26" y1="25" x2="35" y2="35" />
      <polyline points="20,21 22,23 24,21" />
      <polyline points="28,21 26,23 24,21" />
    </>
  ),
  "knowledge-graph": (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <circle cx="38" cy="10" r="2.5" />
      <circle cx="24" cy="24" r="2.5" />
      <circle cx="10" cy="38" r="2.5" />
      <circle cx="38" cy="38" r="2.5" />
      <line x1="12" y1="12" x2="22" y2="22" />
      <line x1="36" y1="12" x2="26" y2="22" />
      <line x1="22" y1="26" x2="12" y2="36" />
      <line x1="26" y1="26" x2="36" y2="36" />
      <line x1="12" y1="10" x2="36" y2="10" strokeDasharray="2,2" />
      <line x1="12" y1="38" x2="36" y2="38" strokeDasharray="2,2" />
    </>
  ),
  rbac: (
    <>
      <path d="M24 5 L41 11 V25 Q41 38 24 44 Q7 38 7 25 V11 Z" />
      <circle cx="20" cy="22" r="3.5" />
      <line x1="22.5" y1="24.5" x2="30" y2="32" />
      <line x1="27" y1="29" x2="29" y2="31" />
      <line x1="29" y1="31" x2="31" y2="29" />
    </>
  ),
  observability: (
    <>
      <rect x="4" y="13" width="40" height="22" rx="1" />
      <line x1="4" y1="19" x2="44" y2="19" />
      <polyline points="6,28 12,28 15,22 19,32 23,18 27,30 31,24 36,28 44,28" />
      <circle cx="40" cy="16" r="0.8" />
    </>
  ),
};

function Sigil({ slug }: { slug: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width="48"
      height="48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-highlight/90"
      aria-hidden="true">
      {sigils[slug]}
    </svg>
  );
}

export function WhatYouGet() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-20 md:py-24">
      <h2 className="mb-12 font-mono text-sm md:text-base">
        <span className="text-highlight/50 select-none">$ </span>
        <span className="text-highlight">cat what-you-get.md</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-10">
        {items.map(({ term, slug, body }) => (
          <div key={term} className="flex gap-5">
            <div className="shrink-0 flex h-14 w-14 items-center justify-center rounded border border-highlight/25 bg-highlight/5">
              <Sigil slug={slug} />
            </div>
            <div className="flex-1">
              <h3 className="mb-1 font-mono text-base md:text-lg text-highlight">
                {term}
              </h3>
              <p className="text-sm md:text-base leading-relaxed text-foreground/85">
                {body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
