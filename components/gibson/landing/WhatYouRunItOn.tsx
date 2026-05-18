const reconMissionCue = `// Recon mission template.
// Discover the target's exposed surface (open ports,
// running services, reachable subdomains).

mission: {
  name:        "recon"
  description: "Reconnaissance across a target's exposed surface."
  version:     "1.0.0"
  target_ref:  ""

  nodes: {
    scan: {
      id:   "scan"
      type: "NODE_TYPE_AGENT"
      agent_config: {
        agent_name: "nmap-agent"
      }
    }
    enrich: {
      id:   "enrich"
      type: "NODE_TYPE_AGENT"
      agent_config: {
        agent_name: "shodan-agent"
      }
    }
  }
  edges: [
    {from: "scan", to: "enrich"},
  ]
  entry_points: ["scan"]
  exit_points:  ["enrich"]
}`;

export function WhatYouRunItOn() {
  return (
    <section className="border-t border-highlight/25">
      <div className="mx-auto max-w-5xl px-4 py-20 md:py-24">
        <h2 className="mb-10 font-mono text-sm md:text-base">
          <span className="text-highlight/50 select-none">$ </span>
          <span className="text-highlight">cat what-you-run-on.md</span>
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          <p className="text-base md:text-lg leading-relaxed text-foreground/90">
            Every agent is built by your team (platform engineers,
            devsecops, red teamers, IR) for the workflows they already
            own. That&apos;s the force multiplier. Agents run where you
            work (laptop, CI, VPS, k8s) and dial out to{" "}
            <code className="font-mono text-highlight">api.zero-day.ai</code>{" "}
            for orchestration, shared memory, and the knowledge graph.
            Your team decides what crosses the wire and what stays on
            the host. BYOK for LLM keys. Untrusted payloads detonate inside{" "}
            <a
              href="https://github.com/zero-day-ai/setec"
              target="_blank"
              rel="noopener noreferrer"
              className="text-highlight font-semibold underline-offset-4 decoration-highlight/40 hover:underline hover:decoration-highlight">
              Setec microVMs
            </a>
            . Hardware isolation, not containers.
          </p>
          <div>
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-highlight/60">
              <span>{'// what a mission looks like'}</span>
              <span>recon.cue</span>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-highlight/25 bg-card/60 p-5 font-mono text-[10px] md:text-[11px] leading-[1.55] text-highlight/90">
              <code>{reconMissionCue}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
