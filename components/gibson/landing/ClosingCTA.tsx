import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ClosingCTA() {
  return (
    <section className="glass-hack border-t py-24">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">
          Attackers move at AI speed. So do you.
        </h2>
        <p className="text-lg text-muted-foreground mt-4 mb-8">
          A novel payload lands in five inboxes at 2am. The triage agent pulls
          the attachment into a microVM, watches it dial a freshly-registered
          C2, maps the indicators into the graph, runs the same query across
          last quarter&apos;s hunts — finds two related artifacts everyone
          missed — and wakes the on-call with the writeup, the IOCs, and a
          suggested EDR rule. The same substrate the red team uses to find
          weaknesses, the blue team uses to contain them. Book a demo; bring a
          real workflow.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button variant="default" size="lg" asChild>
            <a
              href="https://calendly.com/zero-day-ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book a Demo
            </a>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="/signup">Get Started Free</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
