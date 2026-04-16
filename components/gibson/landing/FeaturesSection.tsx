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
    title: "One place to control every AI connection.",
    description:
      "Your AI isn't one thing — it's many, each with its own job. Zero Day AI gives you one place to control what every one of them can reach. Your coding AI can't talk to Salesforce unless you say so. Your triage AI opens tickets but can't touch production. Your research AI reads the data lake but can't send email. Every connection is a decision you made, in one place.",
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
      "Wrap nmap, nuclei, semgrep, Sigma, your EDR API, your custom fuzzer — once, in our SDK. Go, Python, Rust — pick your language. Every AI on the platform can use them, across every team and every workflow. The scanner your red team wraps for engagements is the same scanner your IR team's AI calls at 2am.",
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
      "Every move your AI makes is logged — who did it, to what, when, with what result. Tied to the mission it was part of and any finding it produced. When your CISO or auditor asks what your AI touched last Tuesday, the answer is one query away. The audit trail is already there. You didn't have to build it.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
        Attackers move at AI speed. With Gibson, so do you.
      </h2>
      <p className="text-lg text-muted-foreground text-center max-w-3xl mx-auto mb-12">
        A critical CVE drops at 9am for a framework running across your
        services. A mapping agent queries Gibson's shared graph — 47 services
        affected, 12 internet-exposed, 3 in the customer data path. A
        remediation agent drafts the plan against team ownership; a coding
        agent opens PRs repo-by-repo, each scoped to the permission the owning
        team granted it — no more, no less. A validation agent fires the
        original exploit inside Setec — the hardware-isolated microVM sandbox
        Gibson delegates untrusted code to — against a staged build, and
        confirms the patch holds. By afternoon, fixes are merged with evidence
        attached. Same SDK, same agents, same graph — what your red team built
        to find weaknesses, your blue team uses to close them. Book a demo;
        bring a real CVE.
      </p>
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
