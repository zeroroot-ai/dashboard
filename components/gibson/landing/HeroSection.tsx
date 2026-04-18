import Link from "next/link";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Typewriter } from "@/components/gibson/landing/Typewriter";
import type { TypewriterMessage } from "@/components/gibson/landing/Typewriter";
import { GraphBackground } from "@/components/gibson/landing/GraphBackground";

const messages: TypewriterMessage[] = [
  {
    label: "Pentester",
    text: "Claude, build me a gibson agent to hunt subdomains with amass + httpx + nuclei — kick it off with gibson-cli mission run.",
  },
  {
    label: "DevSecOps",
    text: "Copilot, build me a gibson agent to triage Trivy findings and open Jira tickets — trigger it from CI on every image build.",
  },
  {
    label: "SRE",
    text: "Cursor, build me a gibson agent to monitor our payments service, troubleshoot with kubectl, and fix config via Argo CD — trigger it from Alertmanager webhooks.",
  },
  {
    label: "Bug Bounty",
    text: "Codex, build me a gibson agent to watch my private programs for new subdomains with reproducible nuclei hits — run it nightly via gibson-cli mission run.",
  },
  {
    label: "AppSec",
    text: "Gemini, build me a gibson agent to review PRs for auth-bypass + injection patterns with our org's custom rules — trigger it from CI on every PR.",
  },
  {
    label: "Red Teamer",
    text: "Aider, build me a gibson agent to attempt and score prompt-injection techniques against our company website — trigger it weekly from CI.",
  },
  {
    label: "Developer",
    text: "Cline, build me a gibson agent that bumps stale dependencies, runs the test suite, and opens PRs only when green — run it nightly from CI.",
  },
  {
    label: "IR / SOC",
    text: "Ollama, build me a gibson agent to sweep every new IOC across CloudTrail and k8s audit logs — trigger it from our SIEM webhook.",
  },
];

const terminalLines = [
  "git clone https://github.com/zero-day-ai/adk gibson-adk",
  "cd gibson-adk",
  "gibson-cli init",
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 md:py-28 px-4">
      <GraphBackground />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 52% 58% at 50% 45%, rgba(2,6,4,0.92) 0%, rgba(2,6,4,0.55) 40%, rgba(2,6,4,0) 75%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl flex flex-col items-center gap-10">
        {/* Terminal card */}
        <div className="w-full max-w-2xl rounded-lg border border-green-500/40 bg-black/85 shadow-[0_0_24px_rgba(34,197,94,0.15)] backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-green-500/25 px-4 py-2">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
            <span className="h-3 w-3 rounded-full bg-green-500/70" />
            <span className="ml-3 font-mono text-xs text-green-400/60">
              ~/zero-day
            </span>
          </div>
          <pre className="px-6 py-5 overflow-x-auto font-mono text-sm md:text-base leading-relaxed">
            <code>
              {terminalLines.map((line, i) => (
                <span key={i} className="block">
                  <span className="text-green-400/50 select-none">$ </span>
                  <span className="text-green-300">{line}</span>
                </span>
              ))}
            </code>
          </pre>
        </div>

        {/* Big typewriter prompt */}
        <div className="w-full text-center">
          <Typewriter
            messages={messages}
            typingSpeed={30}
            pauseDuration={5000}
            instantDelete
            className="min-h-[14rem] md:min-h-[12rem] lg:min-h-[10rem] text-xl md:text-2xl lg:text-3xl font-semibold leading-snug max-w-4xl mx-auto"
          />
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button variant="default" size="lg" asChild>
            <Link href="/signup">Start Free</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a
              href="https://github.com/zero-day-ai/gibson-adk"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <Github className="h-4 w-4" />
              Star the ADK
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
