/**
 * CLI command-reference builder (PRD dashboard#738, slice S1).
 *
 * A pure function that produces the labelled, copy-pasteable `gibson` CLI
 * command set for a given tenant + platform URL. It is the single source of
 * truth for the command strings rendered on the Settings → CLI page, and it
 * has no I/O so it can be unit-tested in isolation.
 *
 * The four commands trace the operator's path: authenticate (`login`), mint a
 * component identity (`agent enroll`), check the component in over the
 * Capability-Grant handshake (`component register`), and confirm effective
 * grants (`inspect`). Placeholders (`<name>`, `<bootstrap-token>`) are left
 * literal, they vary per component and per enrollment, so the card teaches the
 * shape rather than pretending to fill them.
 */

/** A single CLI command with its human-readable label and explanation. */
interface CliCommand {
  /** Short label shown above the command (e.g. "Authenticate"). */
  label: string;
  /** The full command string, ready to copy. */
  command: string;
  /** One-line explanation of what the command does. */
  description: string;
}

/** Inputs the builder needs from page context. */
export interface CliCommandSetInput {
  /** The tenant slug passed to `gibson login --tenant`. */
  tenantSlug: string;
  /** The public platform URL the CLI dials, for `--gibson-url`. */
  gibsonUrl: string;
}

/**
 * buildCliCommands returns the ordered command set for the Settings → CLI
 * card. Order is significant: login → enroll → register → inspect.
 */
export function buildCliCommands({
  tenantSlug,
  gibsonUrl,
}: CliCommandSetInput): CliCommand[] {
  const url = gibsonUrl.replace(/\/+$/, "");
  return [
    {
      label: "Authenticate",
      command: `gibson login --gibson-url ${url} --tenant ${tenantSlug}`,
      description:
        "Sign in to this tenant from your terminal via the device-authorization flow. Approve the printed code in your browser.",
    },
    {
      label: "Mint a component identity",
      command: "gibson agent enroll --name <name> --kind agent",
      description:
        "Create a machine identity for an agent, tool, or plugin (set --kind agent|tool|plugin). Prints a one-time bootstrap token.",
    },
    {
      label: "Check the component in",
      command: "gibson component register --token <bootstrap-token>",
      description:
        "Run from the component directory: completes the Capability-Grant handshake and persists the component's runtime credential.",
    },
    {
      label: "Confirm grants",
      command: "gibson inspect",
      description:
        "Show what this principal can do, the effective grants the platform resolved for the checked-in component.",
    },
  ];
}
