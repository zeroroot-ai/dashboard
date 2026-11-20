// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The link from a finding to its view in the graph. An attack path is a view
 * from a finding, so the graph page takes the finding id as a query
 * parameter, selects the node, and isolates it with its neighbors.
 */

/** The query parameter of the graph page that names a finding. */
export const FINDING_PARAM = "finding";

/** The graph page with the finding selected. */
export function findingGraphHref(findingId: string): string {
  return `/dashboard/graph?${FINDING_PARAM}=${encodeURIComponent(findingId)}`;
}
