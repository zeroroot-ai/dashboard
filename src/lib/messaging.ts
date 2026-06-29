/**
 * Canonical messaging source of truth (dashboard#886, parent #885).
 *
 * Every customer-facing landing surface reads its brand copy from here so the
 * surfaces cannot drift apart again. That drift is exactly why #885 exists: the
 * org profile said "agent factory", the dashboard said "security & ops", and the
 * docs said "security work". Edit copy HERE, never inline it in a component.
 *
 * Voice constraints are enforced by
 * scripts/check-no-banned-marketing-phrases.mjs: no probability jargon, no
 * competitor contrast, no "no playbooks" wedge, and the game-engine vocabulary
 * (World / Scroller / tick) stays a product-feature name, never a headline. See
 * the parent PRD's Messaging Spec for the full direction.
 *
 * Names are fixed: zeroroot.ai is the company / umbrella; Gibson is the engine,
 * always written as a proper noun. (The chrome product name, "Zero Root AI",
 * lives separately in ./brand.ts; this module owns positioning copy.)
 */

/** The company / umbrella brand, as written in copy. */
export const COMPANY = "zeroroot.ai";

/** The flagship engine. Always a proper noun. */
export const ENGINE = "Gibson";

/** Umbrella positioning, shared across every surface. */
export const umbrella = {
  tagline: "The zero-trust agent factory.",
  supporting:
    "Build any agent. Run it on a substrate that enforces zero trust at every layer.",
} as const;

/** One Gibson flagship pillar: a buyer-legible outcome, no jargon. */
interface Pillar {
  readonly title: string;
  readonly body: string;
}

/**
 * The three flagship pillars. Pillar 2 is the signature: it is the plain-English
 * reframe of the attack-path belief field. Side-neutral by design (offense walks
 * the path, defense cuts it).
 */
export const pillars: readonly Pillar[] = [
  {
    title: "A living model of your environment",
    body: "Gibson builds one coherent picture as it works: every asset, access path, and exposure it discovers, not a one-time scan.",
  },
  {
    title: "Thinks in paths, not checklists",
    body: "It reasons about how weaknesses chain and where they lead, so you get the handful of paths that are real risk. Attack: walk it. Defend: cut it.",
  },
  {
    title: "Replayable, move by move",
    body: "Rewind and scrub every decision Gibson made: a reproducible record for the operator who ran it and the team reviewing it.",
  },
] as const;

/** Which side of the line a persona sits on. The engine serves all four. */
type PersonaSide = "offense" | "defense" | "purple" | "platform";

interface Persona {
  readonly label: string;
  readonly side: PersonaSide;
}

/**
 * Side-neutral persona set. Offense walks the path, defense cuts it, purple
 * shares one replayable picture, platform/DevSecOps wants reachable risk over a
 * CVE list. Consumed by the landing persona rotator (slice S2, #887).
 */
export const personas: readonly Persona[] = [
  { label: "Pentest", side: "offense" },
  { label: "Red Team", side: "offense" },
  { label: "Bug Bounty", side: "offense" },
  { label: "Blue Team", side: "defense" },
  { label: "SOC", side: "defense" },
  { label: "Incident Response", side: "defense" },
  { label: "Purple Team", side: "purple" },
  { label: "Platform", side: "platform" },
  { label: "DevSecOps", side: "platform" },
] as const;

/** Approved outcome-first headline candidates. The hero leads with the first. */
export const headlines: readonly string[] = [
  "Gibson thinks in paths, not checklists.",
  "Autonomous security that maps how risk actually connects, for the teams breaking in and the teams locking down.",
  "Reachable risk, not a wall of findings.",
  "One engine. Both sides of the line.",
] as const;

/**
 * Hero copy. The headline is split so the engine name renders in the brand
 * highlight: `<highlight>{headlineHighlight}</highlight> {headlineRest}`.
 */
export const hero = {
  eyebrow: "// the zero-trust agent factory",
  headlineHighlight: ENGINE,
  headlineRest: "thinks in paths, not checklists.",
  subhead:
    "Gibson is our autonomous security brain. Point it at your environment and it builds a living model of how risk connects, finds the paths that matter, and replays every move. For the teams breaking in and the teams locking down.",
  ctaPrimary: "Start Free",
  ctaSecondary: "Star the ADK",
  quickstart: "first agent live in under an hour. See the quickstart",
} as const;

/** Closing lockup, reused by footer-adjacent and profile surfaces. */
export const lockup = {
  line: "Your agents. Any domain. Zero-trust substrate.",
  signature: `${COMPANY}, the zero-trust agent factory`,
} as const;
