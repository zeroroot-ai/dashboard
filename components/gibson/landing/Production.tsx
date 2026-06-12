import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Production — deployment shapes + security posture + the path to a paid
 * plan. Every posture line names a shipping mechanism; accreditation
 * claims (IL5/IL6, SOC2, …) stay off the page until they exist.
 */
const posture = [
  {
    term: "short-lived credentials",
    body: "agents enroll once and act on short-lived session tokens, with no long-lived keys on disk",
  },
  {
    term: "tenant isolation",
    body: "your graph, secrets, and traces are scoped to your tenant, never pooled",
  },
  {
    term: "full audit trail",
    body: "every action attributable, every mission replayable",
  },
  {
    term: "open-source core",
    body: "the ADK, setec sandbox, tool runner, and SDK are public, so you can inspect it, audit it, trust it",
  },
] as const;

export function Production() {
  return (
    <section className="border-t border-highlight/25">
      <div className="mx-auto max-w-5xl px-4 py-16 md:py-20">
        <h2 className="mb-6 font-mono text-sm md:text-base">
          <span className="text-highlight/50 select-none">$ </span>
          <span className="text-highlight">cat production.md</span>
        </h2>
        <p className="mb-8 max-w-2xl text-sm md:text-base leading-relaxed text-foreground/90">
          Run on the hosted control plane at{" "}
          <code className="font-mono text-highlight">api.zeroroot.ai</code>,
          or deploy the entire platform into your own Kubernetes cluster with
          a single Helm install,{" "}
          <span className="text-highlight">
            including the enclave your organization has already accredited
          </span>
          . Your authorization boundary stays yours; the platform deploys
          inside it. Either way, the controls regulated environments demand
          are the defaults, not add-ons:
        </p>
        <ul className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
          {posture.map(({ term, body }) => (
            <li key={term} className="flex gap-3">
              <span aria-hidden="true" className="shrink-0 font-mono text-highlight">
                ✔
              </span>
              <p className="text-sm md:text-base leading-relaxed text-foreground/85">
                <span className="font-mono text-highlight">{term}</span>
                {": "}
                {body}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Button variant="outline" size="lg" asChild>
            <a href="mailto:sales@zeroroot.ai?subject=ZeroRoot%20demo%20request">
              Request a demo
            </a>
          </Button>
          <p className="font-mono text-sm leading-relaxed text-foreground/85">
            Every account starts with a 2-week free trial (card required).
            For production tiers (teams, SLAs, audit retention), see{" "}
            <Link
              href="/pricing"
              className="text-link underline underline-offset-4 hover:text-highlight"
            >
              pricing
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
