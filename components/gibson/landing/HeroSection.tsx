import Link from "next/link";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Typewriter } from "@/components/gibson/landing/Typewriter";
import type { TypewriterMessage } from "@/components/gibson/landing/Typewriter";
import { GraphBackground } from "@/components/gibson/landing/GraphBackground";

const messages: TypewriterMessage[] = [
  {
    label: "Pentester",
    text: "Claude, build me a gibson agent to hunt subdomains with amass + httpx + nuclei and deploy it to my engagement VPS.",
  },
  {
    label: "DevSecOps",
    text: "Copilot, build me a gibson agent to triage Trivy findings and open Jira tickets and deploy it to GitHub Actions.",
  },
  {
    label: "SRE",
    text: "Cursor, build me a gibson agent that drafts the incident timeline from Loki + recent deploys the moment a page fires — deploy it to our Slack war room.",
  },
  {
    label: "Bug Bounty",
    text: "Codex, build me a gibson agent to watch my private programs for new subdomains with reproducible nuclei hits — deploy it on my laptop.",
  },
  {
    label: "AppSec",
    text: "Gemini, build me a gibson agent to review PRs for auth-bypass + injection patterns with our org's custom rules — deploy it to our CI.",
  },
  {
    label: "Red Teamer",
    text: "Aider, build me a gibson agent to attempt and score prompt-injection techniques against our company website — deploy it as a weekly CI job.",
  },
  {
    label: "Developer",
    text: "Cline, build me a gibson agent that reproduces every new GitHub issue in a Setec sandbox with a failing test — deploy it to our GitHub org.",
  },
  {
    label: "IR / SOC",
    text: "Ollama, build me a gibson agent to detonate suspicious attachments in Setec and deploy it to our SIEM runner.",
  },
];

const terminalLines = [
  "git clone https://github.com/zero-day-ai/gibson-adk",
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
            "radial-gradient(ellipse 70% 75% at 50% 45%, rgba(2,6,4,0.94) 0%, rgba(2,6,4,0.7) 45%, rgba(2,6,4,0) 85%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl flex flex-col items-center gap-10">
        {/* Terminal card */}
        <div className="w-full max-w-2xl rounded-lg border border-green-500/40 bg-black/85 shadow-[0_0_40px_rgba(34,197,94,0.25)] backdrop-blur-sm">
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
            deletingSpeed={18}
            pauseDuration={2800}
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
