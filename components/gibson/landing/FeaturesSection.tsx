import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Lock, ShieldAlert, Brain, Wrench, Rocket, ClipboardCheck } from "lucide-react";

const features = [
  {
    icon: ShieldAlert,
    title: "Hardware isolation for code you don't trust.",
    description:
      "Firecracker microVMs, not containers. LLM-generated exploits. Third-party C2 payloads. A suspicious attachment pulled from a triage inbox. A nuclei template from an unvetted repo. The agent hands it off, the microVM runs it, the result lands in the graph as evidence. The agent never touched the payload. Your cluster never ran it.",
  },
  {
    icon: Lock,
    title: "The agent RBAC nobody else ships.",
    description:
      "Tool A is allowed for this tenant, not that one. Agent X reads findings, doesn't write them. The IR agent can read the graph, can't push to GitHub. One toggle per call, enforced every time — not just the ones you remembered to check.",
  },
  {
    icon: Brain,
    title: "Memory that outlives the engagement.",
    description:
      "The subdomains your last pentest enumerated are still there. The C2 IOCs from last week's hunt are still there. The RAG-poisoning payload that bypassed the customer's filter is still there. Every next agent — red or blue — starts from what every previous one learned.",
  },
  {
    icon: Wrench,
    title: "One tool library. Every agent. Every team.",
    description:
      "Wrap nmap, nuclei, semgrep, Sigma, your EDR API, your custom fuzzer — once. In Go, Python, Rust, whatever. Queue-backed, scaled by Kubernetes. The wrapper your pentester writes is the wrapper your IR agent calls.",
  },
  {
    icon: Rocket,
    title: "Production from the first line of code.",
    description:
      "Retries, tracing, health probes, queue backpressure, tenant isolation, audit — wired before you write a line. The agent that works on your laptop is the agent that runs on the cluster. You write it Tuesday; you ship it Friday.",
  },
  {
    icon: ClipboardCheck,
    title: "The audit log that writes itself.",
    description:
      "Every LLM call, tool invocation, graph read, memory write — actor, policy decision, resource, bytes, tokens, latency, outcome. Linked to the mission and the finding. CISO opens a query. You don't build a pipeline.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
        Opinionated about the boring parts. Out of your way for the new ones.
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="glass-hack">
            <CardHeader>
              <Icon className="h-8 w-8 text-green-500" />
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
