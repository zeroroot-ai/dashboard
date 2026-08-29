import type { z } from "zod";
import type { componentRefSchema } from "./schemas";

type ComponentRef = z.infer<typeof componentRefSchema>;

/**
 * The daemon's component object is `component:<kind>/<name>` (gibson ADR-0015,
 * authz.ComponentObject). SetCatalogEnabled prefixes `component:` itself, so
 * the ref it receives is `<kind>/<name>`. The old `<kind>-<name>` spelling
 * came from the CRD era and landed the tuple on an object nothing reads.
 *
 * Lives outside grant.ts on purpose: that file is "use server", and Next.js
 * admits only async exports there.
 */
export function componentKey(ref: ComponentRef): string {
  return `${ref.kind}/${ref.name}`;
}
