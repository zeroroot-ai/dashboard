import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Typewriter } from "@/components/gibson/landing/Typewriter";
import type { TypewriterMessage } from "@/components/gibson/landing/Typewriter";
import { GraphBackground } from "@/components/gibson/landing/GraphBackground";

const messages: TypewriterMessage[] = [
  { label: "Red Teamer", text: "Same boring 80% every engagement. Writing the glue is why you never automated it. Gibson is the glue." },
  { label: "DevSecOps", text: "Scanners don't share context. Your AI should. Every agent lands in the same graph. Data and systems access is a toggle, not a code change." },
  { label: "Platform Eng", text: "Security, AppSec, SRE — everyone wants agents. One SDK, one graph, one place to look." },
  { label: "Threat Hunter", text: "Every hunt starts from zero. It shouldn't. Last week's hunt is still in the graph — the next one starts there." },
];

export function HeroSection() {
  return (
    <>
      <section className="relative overflow-hidden py-24 md:py-32 px-4 text-center">
        <GraphBackground />
        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold">
            Give your agents a brain that survives reboots.
          </h1>

          <p className="text-lg font-semibold text-foreground mt-4 max-w-2xl mx-auto">
            Your teams want AI that closes tickets — not opens them. Your CISO wants to know what it did — and who let it. Your platform team wants one stack — not five. One graph every agent shares. One permission flip for every call. One audit trail your auditor already accepts.
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
