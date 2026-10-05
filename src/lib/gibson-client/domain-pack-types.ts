// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Domain Pack data-transfer objects (ADR-0133, gibson#383).
 *
 * Plain JSON shapes the domain-pack Server Actions return to the browser: the
 * daemon proto messages never cross the API boundary. The typed server client
 * (./domain-packs.ts, server-only) produces them; the catalog panel
 * (components/gibson/settings/DomainPacksContent.tsx, a client component)
 * renders them. Both sides import these types so the wire contract has one
 * definition. This module is transport-free on purpose, so a client
 * component may import it.
 */

/** DomainPackCatalogEntryDTO is one curated Domain Pack the tenant may enable. */
export interface DomainPackCatalogEntryDTO {
  name: string;
  version: number;
  /** Who curates this pack. The platform owner for every catalog entry. */
  author: string;
  /** "public" or "private". A catalog entry is always "public". */
  visibility: string;
  taxonomyNodeLabels: string[];
  taxonomyRelationshipTypes: string[];
  /** The technique names this pack binds a settlement predicate for. */
  techniques: string[];
}

/** DomainPackViewDTO is one of the tenant's currently enabled Domain Packs. */
export interface DomainPackViewDTO {
  name: string;
  version: number;
  techniques: string[];
}
