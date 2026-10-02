// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';
/**
 * Typed dashboard client for gibson.tenant.v1.DomainPackService (ADR-0033,
 * gibson#383).
 *
 * A Domain Pack is curated, versioned structure, taxonomy labels, ontology
 * extensions and technique-to-CEL-predicate bindings, never code (ADR-0033
 * decision 1). ListDomainPackCatalog reads the curated catalog a tenant may
 * enable; ListDomainPacks reads what that tenant currently has enabled;
 * EnableDomainPack/DisableDomainPack fold the per-tenant lifecycle event
 * (ADR-0033: "per-tenant, not per-install"). Every RPC dispatches through the
 * user-acting transport (userClient), so it flows dashboard -> Envoy ->
 * daemon like every other tenant RPC, never a direct daemon channel. The
 * daemon does all the work; this file is a thin, typed delegation surface
 * for the Server Actions in app/actions/domain-packs.ts.
 */
import { userClient } from '../gibson-client';
import { DomainPackService } from '@/src/gen/gibson/tenant/v1/domain_pack_pb';
import type {
  DomainPackCatalogEntry,
  DomainPackView,
} from '@/src/gen/gibson/tenant/v1/domain_pack_pb';
import { throwMapped } from './secrets';
import type { DomainPackCatalogEntryDTO, DomainPackViewDTO } from './domain-pack-types';

function toCatalogEntryDTO(e: DomainPackCatalogEntry): DomainPackCatalogEntryDTO {
  return {
    name: e.name,
    version: e.version,
    author: e.author,
    visibility: e.visibility,
    taxonomyNodeLabels: e.taxonomyNodeLabels,
    taxonomyRelationshipTypes: e.taxonomyRelationshipTypes,
    techniques: e.techniques,
  };
}

function toViewDTO(p: DomainPackView): DomainPackViewDTO {
  return { name: p.name, version: p.version, techniques: p.techniques };
}

/** List the curated Domain Packs this tenant may enable ("member" relation). */
export async function daemonListDomainPackCatalog(): Promise<DomainPackCatalogEntryDTO[]> {
  try {
    const client = userClient(DomainPackService);
    const resp = await client.listDomainPackCatalog({});
    return (resp.entries ?? []).map(toCatalogEntryDTO);
  } catch (err) {
    throwMapped(err);
  }
}

/** List the tenant's currently enabled Domain Packs ("member" relation). */
export async function daemonListDomainPacks(): Promise<DomainPackViewDTO[]> {
  try {
    const client = userClient(DomainPackService);
    const resp = await client.listDomainPacks({});
    return (resp.packs ?? []).map(toViewDTO);
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Enable a catalog Domain Pack for this tenant ("admin" relation). Folds a
 * DomainPackEnabled event that loads the pack's bindings into the tenant's
 * live World only.
 */
export async function daemonEnableDomainPack(
  name: string,
): Promise<{ name: string; version: number }> {
  try {
    const client = userClient(DomainPackService);
    const resp = await client.enableDomainPack({ name });
    return { name: resp.name, version: resp.version };
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Disable a Domain Pack for this tenant ("admin" relation). Folds a
 * DomainPackDisabled event that removes the pack's bindings from the
 * tenant's live World.
 */
export async function daemonDisableDomainPack(name: string): Promise<void> {
  try {
    const client = userClient(DomainPackService);
    await client.disableDomainPack({ name });
  } catch (err) {
    throwMapped(err);
  }
}
