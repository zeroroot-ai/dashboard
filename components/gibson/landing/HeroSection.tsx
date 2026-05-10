import Link from "next/link";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Typewriter } from "@/components/gibson/landing/Typewriter";
import type { TypewriterMessage } from "@/components/gibson/landing/Typewriter";
import { GraphBackground } from "@/components/gibson/landing/GraphBackground";

const messages: TypewriterMessage[] = [
  {
    label: "Pentester",
    text: "Claude, build me a gibson agent to hunt subdomains with amass + httpx + nuclei — kick it off with gibson mission submit.",
  },
  {
    label: "DevSecOps",
    text: "Amp, build me a gibson agent to triage Trivy findings and open Jira tickets — trigger it from CI on every image build.",
  },
  {
    label: "SRE",
    text: "Cursor, build me a gibson agent to monitor our payments service, troubleshoot with kubectl, and fix config via Argo CD — trigger it from Alertmanager webhooks.",
  },
  {
    label: "Bug Bounty",
    text: "Codex, build me a gibson agent to watch my private programs for new subdomains with reproducible nuclei hits — run it nightly via gibson mission submit.",
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
    text: "Crush, build me a gibson agent that bumps stale dependencies, runs the test suite, and opens PRs only when green — run it nightly from CI.",
  },
  {
    label: "IR / SOC",
    text: "opencode, build me a gibson agent to sweep every new IOC across CloudTrail and k8s audit logs — trigger it from our SIEM webhook.",
  },
];

const terminalLines: Array<[string, string, "cmd" | "ok" | "info" | "sandbox"]> = [
  ["$", "git clone https://github.com/zero-day-ai/adk gibson-adk", "cmd"],
  ["$", "cd gibson-adk", "cmd"],
  ["$", "gibson component init recon-agent", "cmd"],
  ["$", "gibson component build", "cmd"],
  ["$", "gibson mission submit missions/recon.yaml --target example.com", "cmd"],
  ["✔", "connected · spiffe://zero-day.ai/agent · gRPC mTLS", "ok"],
  ["→", "mission queued · 3 steps running", "info"],
  ["↳", "untrusted payload detonated in setec microVM", "sandbox"],
  ["✔", "graph: 47 hosts · 12 findings → neo4j", "ok"],
];

const lineColor: Record<"cmd" | "ok" | "info" | "sandbox", string> = {
  cmd: "text-green-300",
  ok: "text-emerald-300",
  info: "text-cyan-300/90",
  sandbox: "text-amber-300/90",
};

function Pulse({
  char = "●",
  amber = false,
}: {
  char?: string;
  amber?: boolean;
}) {
  return (
    <span
      className={
        amber
          ? "text-amber-300 motion-safe:animate-pulse"
          : "text-emerald-300 motion-safe:animate-pulse"
      }
      style={{
        textShadow: amber
          ? "0 0 6px rgba(252, 211, 77, 0.6)"
          : "0 0 6px rgba(34, 197, 94, 0.6)",
      }}
    >
      {char}
    </span>
  );
}

function Schematic() {
  return (
    <div className="relative rounded-lg border border-emerald-500/25 bg-emerald-950/15 p-5 shadow-[0_0_40px_rgba(16,185,129,0.18)] backdrop-blur-md">
      {/* corner brackets — schematic vibe, not a terminal window */}
      <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1.5 font-mono text-xs text-emerald-400/50">┏</span>
      <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1.5 font-mono text-xs text-emerald-400/50">┓</span>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-1.5 font-mono text-xs text-emerald-400/50">┗</span>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 right-1.5 font-mono text-xs text-emerald-400/50">┛</span>

      <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400/70">
        <span>◆ split control plane</span>
        <span className="flex items-center gap-1.5">
          <Pulse char="●" /> live
        </span>
      </div>

      <pre className="overflow-x-auto font-mono text-[11px] md:text-xs leading-[1.7] text-emerald-200/85">
        <code>
{` EXECUTION PLANE           ╎    CONTROL PLANE · api.zero-day.ai\n`}
{` ┌──────────────────┐      ╎    ┌──────────────────────┐\n`}
{` │ `}<Pulse />{` agent binary   │      ╎    │ `}<Pulse />{` gibson      LIVE   │\n`}
{` │   runs on:       │      ╎    │ `}<Pulse />{` neo4j       READY  │\n`}
{` │   laptop · ci ·  │ ═════╪═══►│ `}<Pulse />{` redis       READY  │\n`}
{` │   vps · k8s      │ gRPC ╎    │ `}<Pulse />{` langfuse    READY  │\n`}
{` └────────┬─────────┘      ╎    │ `}<Pulse char="◢" amber />{` setec       ARMED  │\n`}
{`          │                ╎    └──────────────────────┘\n`}
{`          ▼                ╎\n`}
{` `}<Pulse />{` byok keys ─▶ anthropic · openai · gemini · ollama\n`}
{` ──────────────────────────────────────────────────────\n`}
{` `}<Pulse />{` AGENTS ACTIVE  │  `}<Pulse />{` SANDBOX READY  │  `}<Pulse />{` GRAPH SYNCED`}
        </code>
      </pre>
    </div>
  );
}

function TerminalCard() {
  return (
    <div className="rounded-lg border border-green-500/40 bg-black/85 shadow-[0_0_24px_rgba(34,197,94,0.15)] backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-green-500/25 px-4 py-2">
        <span className="h-3 w-3 rounded-full bg-red-500/70" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <span className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 font-mono text-xs text-green-400/60">
          ~/zero-day
        </span>
      </div>
      <pre className="overflow-x-auto px-5 py-5 font-mono text-[12px] md:text-sm leading-relaxed">
        <code>
          {terminalLines.map(([prefix, text, kind], i) => (
            <span key={i} className="block">
              <span className="select-none text-green-400/50">{prefix} </span>
              <span className={lineColor[kind]}>{text}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

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

      <div className="relative z-10 mx-auto max-w-6xl flex flex-col items-center gap-10">
        {/* Split control plane: schematic (left) + real terminal session (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
          <Schematic />
          <TerminalCard />
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
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="default" size="lg" asChild>
              <Link href="/pricing">Start Free</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a
                href="https://github.com/zero-day-ai/adk"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <Github className="h-4 w-4" />
                Star the ADK
              </a>
            </Button>
          </div>
          <p className="font-mono font-semibold text-glow-green-soft text-sm md:text-base lg:text-lg leading-snug text-center">
            Stand up your security agent factory in under an hour.
          </p>
        </div>
      </div>
    </section>
  );
}
