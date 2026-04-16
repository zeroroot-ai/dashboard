import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Lock, ShieldAlert, Brain, Wrench, Rocket, ClipboardCheck } from "lucide-react";

const features = [
  {
    icon: Lock,
    title: "The agent RBAC nobody else ships.",
    description:
      "Every other agent framework is bring-your-own-auth — wire OAuth, build a role model, write middleware, debug it in prod. Not here. Tool A is allowed to this tenant, not that one. Agent X can read findings but not write them. One agent, one tool, one tenant, one toggle — on or off — enforced on every call, not just the ones you remembered to check.",
  },
  {
    icon: ShieldAlert,
    title: "A VM for code you don't trust.",
    description:
      "LLM-generated exploits. Third-party C2 payloads. A fuzzer aimed at a parser you expect will segfault the kernel. A nuclei template from an unvetted GitHub repo. Your agent hands them off to a sandbox, the sandbox runs them, output comes back in the graph as evidence. The agent never touched the payload. Your cluster never ran it. You get the result; nothing else moves.",
  },
  {
    icon: Brain,
    title: "Memory that outlives the engagement.",
    description:
      "The subdomains your last agent enumerated are still there. The exploit that worked in last quarter's pentest is still there. The RAG-poisoning payload that bypassed the customer's filter is still there. Your next agent starts from everything every previous agent learned. Institutional memory isn't in a Slack channel — it's in the graph.",
  },
  {
    icon: Wrench,
    title: "The tool library your whole org shares.",
    description:
      "Wrap nmap, nuclei, semgrep, your internal scanner, your custom fuzzer — once. In Go, Python, Rust, or whatever. Every agent in the org calls it, queue-backed, scaled by Kubernetes. The nmap wrapper your pentester writes is the nmap wrapper your compliance agent calls.",
  },
  {
    icon: Rocket,
    title: "Production from the first line of code.",
    description:
      "Retries, tracing, health probes, queue backpressure, tenant isolation, audit — all wired under the hood before you write a line. There's no \"harden it for prod\" phase. The agent that works on your laptop is the agent that runs on the cluster. You write it Tuesday; you ship it Friday.",
  },
  {
    icon: ClipboardCheck,
    title: "The audit log that writes itself.",
    description:
      "Every call your agent makes — to an LLM, a tool, the graph, the memory — produces a structured record. Actor, policy decision, resource touched, bytes, tokens, latency, outcome. Linked to the mission that asked for it and the finding it produced. When your CISO asks what the AI did last night, you open a query. You don't build an evidence pipeline.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
        The Parts You Don&apos;t Want to Write. Already Written.
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
