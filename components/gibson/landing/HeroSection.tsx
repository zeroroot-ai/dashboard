import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Typewriter } from "@/components/gibson/landing/Typewriter";
import type { TypewriterMessage } from "@/components/gibson/landing/Typewriter";
import { GraphBackground } from "@/components/gibson/landing/GraphBackground";

const messages: TypewriterMessage[] = [
  { label: "Red Teamer", text: "Same boring 80% every engagement. Writing the glue is why you never automated it. Zero Day AI is the glue." },
  { label: "SOC / IR", text: "Triage, enrichment, containment. The AI that reads the alert pulls the payload into a sandbox and runs the same query across last quarter's hunts." },
  { label: "Detection Eng", text: "Last week's hunt is still in the graph. The next detection starts there." },
  { label: "DevSecOps", text: "Trivy and other scanners don't share context. Your AI should. Same finding, explained to execs, engineers, and auditors at the level each one needs." },
  { label: "Platform Eng", text: "Security, AppSec, SRE, IR — everyone wants agents. One SDK, one graph, one place to look." },
  { label: "AppSec", text: "The PR landed at 6pm. The fix opened at 9am. Same parameter, scanned, verified in a sandbox, patched." },
];

export function HeroSection() {
  return (
    <>
      <section className="relative overflow-hidden py-24 md:py-32 px-4 text-center">
        <GraphBackground />
        {/* radial vignette darkens the graph behind the hero copy so text stays legible */}
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 65% at 50% 50%, rgba(2,6,4,0.92) 0%, rgba(2,6,4,0.6) 45%, rgba(2,6,4,0) 80%)",
          }}
        />
        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold">
            Research. Automate. Operate. Same day, same guardrails.
          </h1>

          <p className="text-lg font-semibold text-foreground mt-4 max-w-2xl mx-auto">
            Attackers ship new techniques in hours. You can't keep up in silos. Shared, sandboxed, governed. What one team builds, everyone can use.
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
