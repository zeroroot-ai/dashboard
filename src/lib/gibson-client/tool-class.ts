// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Group the enabled connectors by tool class (dashboard#381). A buyer sees
 * which of their tools Gibson reads. The tool class belongs to the catalog
 * entry of a connector. A connector with no tool class goes under "unknown".
 * This module is transport-free, so a client component may import it.
 */

import type { CatalogEntryDTO, ConnectorDTO } from "./connector-types";

export interface ToolClassGroup {
  /** The tool class, or an empty string for the group "unknown". */
  toolClass: string;
  connectors: ConnectorDTO[];
}

const UNKNOWN = "Unknown";

/** The label of a tool class. */
export function toolClassLabel(toolClass: string): string {
  return toolClass || UNKNOWN;
}

/**
 * Group connectors by the tool class of their catalog entry. The groups sort
 * by name, and the group "unknown" comes last. Connectors keep their order
 * inside a group.
 */
export function groupByToolClass(
  connectors: readonly ConnectorDTO[],
  catalog: readonly CatalogEntryDTO[],
): ToolClassGroup[] {
  const classOf = new Map(catalog.map((e) => [e.id, e.toolClass]));
  const groups = new Map<string, ConnectorDTO[]>();
  for (const c of connectors) {
    const key = classOf.get(c.id) ?? "";
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([toolClass, list]) => ({ toolClass, connectors: list }));
}
