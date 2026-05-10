/**
 * GlossaryProvider — loads the vendored glossary.json (controlled
 * vocabulary mapping every NodeType / MergeStrategy / Language /
 * message name + verb name to its proto-derived description) and
 * exposes a useGlossary() hook for lookup.
 *
 * Vendored by scripts/vendor-mission-authoring-bundle.mjs into
 * src/data/glossary.json. The glossary is a flat string map; lookup
 * is O(1) by key.
 *
 * Spec: mission-dashboard-rewrite Requirement 5 AC 2.
 */

"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import glossary from "@/src/data/glossary.json";

type GlossaryMap = Record<string, string>;

const GlossaryContext = createContext<GlossaryMap | null>(null);

export function GlossaryProvider({ children }: { children: ReactNode }) {
  // Cast through unknown because the imported JSON's TS type is
  // narrowed to its keys; we want the open-ended string→string map
  // shape so callers can look up arbitrary terms.
  const map = useMemo(
    () => glossary as unknown as GlossaryMap,
    [],
  );
  return (
    <GlossaryContext.Provider value={map}>
      {children}
    </GlossaryContext.Provider>
  );
}

/**
 * useGlossary — returns the loaded glossary map. Returns an empty
 * object if the provider isn't mounted (graceful fallback per
 * design.md Component 5).
 */
export function useGlossary(): GlossaryMap {
  return useContext(GlossaryContext) ?? {};
}

/**
 * lookupTerm — convenience helper that returns the description
 * for `term` or undefined if not found. Use this when you have a
 * known term to render but the calling component isn't a hook
 * site.
 */
export function lookupTerm(map: GlossaryMap, term: string): string | undefined {
  return map[term];
}
