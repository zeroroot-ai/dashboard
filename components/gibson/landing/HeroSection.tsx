import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Typewriter } from "@/components/gibson/landing/Typewriter";
import type { TypewriterMessage } from "@/components/gibson/landing/Typewriter";
import { GraphBackground } from "@/components/gibson/landing/GraphBackground";

const messages: TypewriterMessage[] = [
  { label: "Red Teamer", text: "Same boring 80% every engagement. Writing the glue is why you never automated it. Gibson is the glue." },
  { label: "SOC / IR", text: "Triage, enrichment, containment. The agent that reads the alert is the agent that pulled the payload into a microVM and ran the same query across last quarter's hunts." },
  { label: "Detection Eng", text: "Last week's hunt is still in the graph. The next detection starts there." },
  { label: "DevSecOps", text: "Scanners don't share context. Your AI should. Permission scope is a toggle, not a code change." },
  { label: "Platform Eng", text: "Security, AppSec, SRE, IR — everyone wants agents. One SDK, one graph, one place to look." },
  { label: "AppSec", text: "The PR landed at 6pm. The fix opened at 9am. Same parameter, scanned, verified in a sandbox, patched." },
];

export function HeroSection() {
  return (
    <>
      <section className="relative overflow-hidden py-24 md:py-32 px-4 text-center">
        <GraphBackground />
        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold">
            Security R&amp;D to production. Same day. Same safety.
          </h1>

          <p className="text-lg font-semibold text-foreground mt-4 max-w-2xl mx-auto">
            Attackers ship new techniques in hours. Your defenders, red team, and AppSec need a substrate — not another tool — to do the same. One isolation boundary. One RBAC model. One knowledge graph every agent shares. One audit log your CISO already accepts. Everything you build, red or blue, inherits all of it on day one.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <Button variant="default" size="lg" asChild>
              <Link href="/signup">Get Started Free</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a href="https://calendly.com/zero-day-ai" target="_blank" rel="noopener noreferrer">
                Book a Demo
              </a>
            </Button>
          </div>
        </div>
      </section>

      <div className="border-t border-border bg-background py-6 text-center">
        <Typewriter messages={messages} />
      </div>
    </>
  );
}
