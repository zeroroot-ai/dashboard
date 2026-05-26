function Pulse({
  char = "●",
  amber = false,
}: {
  char?: string;
  amber?: boolean;
}) {
  return (
    <span
      className={
        amber
          ? "text-alt motion-safe:animate-pulse"
          : "text-highlight motion-safe:animate-pulse"
      }
      style={{
        textShadow: amber
          ? "0 0 6px color-mix(in oklch, var(--alt) 60%, transparent)"
          : "0 0 6px color-mix(in oklch, var(--highlight) 60%, transparent)",
      }}
    >
      {char}
    </span>
  );
}

export function ArchitectureDiagram() {
  return (
    <section className="border-t border-highlight/25">
      <div className="mx-auto max-w-5xl px-4 py-20 md:py-24">
        <h2 className="mb-10 font-mono text-sm md:text-base">
          <span className="text-highlight/50 select-none">$ </span>
          <span className="text-highlight">cat zero-trust-architecture.md</span>
        </h2>

        <div
          className="relative rounded-lg border border-highlight/25 bg-highlight/5 p-5 backdrop-blur-md"
          style={{
            boxShadow:
              "0 0 40px color-mix(in oklch, var(--highlight) 18%, transparent)",
          }}
        >
          <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1.5 font-mono text-xs text-highlight/50">┏</span>
          <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1.5 font-mono text-xs text-highlight/50">┓</span>
          <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-1.5 font-mono text-xs text-highlight/50">┗</span>
          <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 right-1.5 font-mono text-xs text-highlight/50">┛</span>

          <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-highlight/70">
            <span>◆ platform architecture</span>
            <span className="flex items-center gap-1.5">
              <Pulse char="●" /> live
            </span>
          </div>

          <pre className="overflow-x-auto font-mono text-[11px] md:text-xs leading-[1.7] text-highlight/85">
            <code>
{` ┌────────────────────────────────────────────────────────────────────────────────────────┐\n`}
{` │  CUSTOMER ENVIRONMENT                                                                  │\n`}
{` │                                                                                        │\n`}
{` │  `}<Pulse />{` agent binary           `}<Pulse char="◢" amber />{` setec microVM              `}<Pulse />{` byok llm keys                │\n`}
{` │    laptop · ci · vps        hardware VM · not            anthropic · openai            │\n`}
{` │    k8s · any runtime        containers · detonates        gemini · ollama              │\n`}
{` │                             untrusted payloads                                         │\n`}
{` │                                                                                        │\n`}
{` │  [on-prem k8s · optional]  SPIFFE SVID · SPIRE on-cluster  workload identity          │\n`}
{` └──────────────────────────────────────────────────┬─────────────────────────────────────┘\n`}
{`                                                    │  gRPC + TLS\n`}
{`                                                    │  OIDC bearer token per call\n`}
{`                                                    ▼\n`}
{` ┌────────────────────────────────────────────────────────────────────────────────────────┐\n`}
{` │  CONTROL PLANE · api.zero-day.ai                                                       │\n`}
{` │                                                                                        │\n`}
{` │  ┌───────────────────────────────────────────────┐                                     │\n`}
{` │  │  envoy (edge)                                 │                                     │\n`}
{` │  │    jwt_authn ── validates Zitadel OIDC JWT    │                                     │\n`}
{` │  │    ext-authz ── openfga policy check per RPC  │                                     │\n`}
{` │  └──────────────────────┬────────────────────────┘                                     │\n`}
{` │                         │  SPIFFE mTLS                                                 │\n`}
{` │                         ▼                                                              │\n`}
{` │  `}<Pulse />{` daemon · gRPC :50051                                                                │\n`}
{` │    reads x-gibson-identity-* headers · no auth logic of its own                       │\n`}
{` │                         │                                                              │\n`}
{` │                         ▼  pool.For(ctx, tenant)                                      │\n`}
{` │  ┌──────────────────────────────────────────────────────────────────────────────────┐  │\n`}
{` │  │  DATA PLANE  (physically isolated per tenant)                                    │  │\n`}
{` │  │  postgres  ·  neo4j (knowledge graph)  ·  redis  ·  vector store                │  │\n`}
{` │  └──────────────────────────────────────────────────────────────────────────────────┘  │\n`}
{` │                                                                                        │\n`}
{` │  ┌───────────────────┐  ┌──────────────────────┐  ┌──────────────────────────────┐    │\n`}
{` │  │  zitadel          │  │  vault               │  │  gibson traces               │    │\n`}
{` │  │  OIDC · OAuth2    │  │  managed secrets     │  │  prompt + tool call replay   │    │\n`}
{` │  │  identity + SSO   │  │  ESO-delivered       │  │  per-mission · per-agent     │    │\n`}
{` │  └───────────────────┘  └──────────────────────┘  └──────────────────────────────┘    │\n`}
{` │                                                                                        │\n`}
{` │  SPIRE · SPIFFE  platform service mesh                                                 │\n`}
{` │  envoy ─▶ daemon ─▶ tenant-operator ─▶ platform-operator                              │\n`}
{` └────────────────────────────────────────────────────────────────────────────────────────┘`}
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}
