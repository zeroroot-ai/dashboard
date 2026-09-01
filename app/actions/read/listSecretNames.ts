"use server";

/**
 * Read-only Server Action: the names of the tenant's secrets, for the
 * credential-names typeahead of the job node form (gibson#1706 lane E4).
 * Names only, never a value: `listSecrets` returns metadata, and this action
 * keeps only the name.
 */

import { getServerSession } from "@/src/lib/auth";
import { listSecrets } from "@/src/lib/gibson-client/secrets";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function listSecretNamesAction(): Promise<ActionResult<string[]>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const names: string[] = [];
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await listSecrets({ limit, offset });
      for (const s of page.secrets) names.push(s.name);
      if (page.secrets.length < limit) break;
      offset += limit;
    }
    return { ok: true, data: names.sort() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list secrets" };
  }
}
