import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ClosingCTA() {
  return (
    <section className="glass-hack border-t py-24">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">
          The vuln shipped at 6pm. The fix shipped at 9am.
        </h2>
        <p className="text-lg text-muted-foreground mt-4 mb-8">
          A dev pushed a new parameter on an API endpoint. The agent noticed —
          yesterday&apos;s surface area is in the graph, today&apos;s
          isn&apos;t — queued the right scanner against the diff, verified the
          injection in a sandbox, wrote the fix, opened the PR. You wake up to
          a review, not an incident. Book a demo; bring a repo you actually
          ship from.
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
