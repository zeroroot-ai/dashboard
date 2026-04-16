import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ClosingCTA() {
  return (
    <section className="glass-hack border-t py-24">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">
          Opinionated about the boring parts. Your strategy, your tactics.
        </h2>
        <p className="text-lg text-muted-foreground mt-4 mb-8">
          Designed to be a force multiplier for your security, operations, and
          development teams — one substrate, shared across every workflow.
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
