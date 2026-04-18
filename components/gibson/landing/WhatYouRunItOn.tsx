const diagram = `  your runtime                          api.zero-day.ai (saas)
  ┌────────────────────┐                ┌─────────────────────┐
  │  agent binary      │                │  gibson             │
  │  (laptop / ci /    │ ──── grpc ───▶ │  neo4j              │
  │   vps / k8s)       │                │  redis              │
  └────────────────────┘                │  langfuse           │
           │                            │  setec microvms     │
           ▼                            └─────────────────────┘
  byok llm keys ──▶ anthropic · openai · gemini · ollama`;

export function WhatYouRunItOn() {
  return (
    <section className="border-t border-green-500/25">
      <div className="mx-auto max-w-5xl px-4 py-20 md:py-24">
        <h2 className="mb-10 font-mono text-sm md:text-base">
          <span className="text-green-400/50 select-none">$ </span>
          <span className="text-green-300">cat what-you-run-on.md</span>
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          <p className="text-base md:text-lg leading-relaxed text-green-50/90">
            Your agents run where you already work — laptop, CI runner,
            bug-bounty VPS, your own cluster. They dial out to Gibson at{" "}
            <code className="font-mono text-green-300">api.zero-day.ai</code>{" "}
            for orchestration, shared memory, and the knowledge graph. BYOK
            for LLM keys. Untrusted payloads — LLM-generated exploits,
            malware samples, sketchy third-party tools — detonate inside{" "}
            <strong className="text-green-300 font-semibold">
              Setec microVMs
            </strong>
            . Hardware isolation, not containers.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-green-500/25 bg-black/60 p-6 font-mono text-[13px] md:text-sm leading-relaxed text-green-300/90">
            <code>{diagram}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
