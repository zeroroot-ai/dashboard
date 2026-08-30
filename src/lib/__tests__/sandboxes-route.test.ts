/**
 * The agent console lives at /dashboard/sandboxes (dashboard#1159). The old
 * path is a permanent redirect only, and nothing else references it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const OLD = "/dashboard/agents/console";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe("sandboxes route", () => {
  it("redirects the old console path permanently and keeps the query string", async () => {
    const mod = await import("../../../next.config");
    const cfg = mod.default as { redirects?: () => Promise<{ source: string; destination: string; permanent: boolean }[]> };
    const entries = await cfg.redirects!();
    const hit = entries.find((r) => r.source === OLD);
    expect(hit).toEqual({ source: OLD, destination: "/dashboard/sandboxes", permanent: true });
    // No path segment is rewritten, so Next carries ?run=<id> through unchanged.
    expect(hit!.destination).not.toContain(":");
  });

  it("has no reference to the old path outside the redirect", () => {
    const offenders = ["app", "components", "src"]
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => !f.includes("__tests__") && readFileSync(f, "utf8").includes(OLD));
    expect(offenders).toEqual([]);
  });

  it("serves the surface from the sandboxes page", () => {
    const page = readFileSync(join(ROOT, "app/dashboard/(auth)/sandboxes/page.tsx"), "utf8");
    expect(page).toContain('canonical: "/sandboxes"');
    expect(page).toContain("AgentConsole");
  });
});
