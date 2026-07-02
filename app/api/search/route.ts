/**
 * Docs search API.
 *
 * Powers the client-side `⌘K / Ctrl+K` search dialog rendered by
 * Fumadocs under `/docs`. Consumes the compiled docs source tree
 * from `lib/source.ts` and returns an in-memory Orama-backed result
 * set, no external search provider, no runtime dependency on the
 * daemon, Neo4j, or Postgres.
 *
 * This is public by design (docs are public); no auth gating.
 */
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

export const { GET } = createFromSource(source);
