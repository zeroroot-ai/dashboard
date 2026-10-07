// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';
/**
 * Typed dashboard client for gibson.tenant.v1.OntologyExtensionService
 * (ADR-0033 decision 3, gibson#618, dashboard#191).
 *
 * An agent proposes a node label or a relationship type that the ontology
 * does not hold. The proposal changes nothing until the tenant Owner
 * approves it. The list carries the "admin" relation on the tenant, the
 * three decisions carry "owner". Every call goes through the user-acting
 * transport (userClient), never a direct channel.
 */
import {
  OntologyExtensionService,
  OntologyProposalKind,
  OntologyProposalStatus,
} from '@/src/gen/gibson/tenant/v1/ontology_extension_pb';

import { userClient } from '../gibson-client';

export type ProposalKind = 'node_label' | 'relationship_type';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'unspecified';

export interface OntologyProposalDTO {
  kind: ProposalKind;
  label: string;
  /** How many independent times agents proposed this kind and label. */
  recurrence: number;
  lastProposer: string;
  lastClaim: string;
  status: ProposalStatus;
  reviewer: string;
  /** Set only when the status is rejected. */
  rejectReason: string;
  /** True once the label is in the live ontology of the tenant. */
  promoted: boolean;
  /** The ontology version that holds the label. Zero when not promoted. */
  promotedTaxonomyVersion: number;
}

export interface UpstreamContributionDTO {
  /** The audit record that holds the submitted fragment. */
  auditRecordId: string;
  /** The domain pack fragment, as JSON text. */
  packJson: string;
  suggestedFilePath: string;
  suggestedPrTitle: string;
  suggestedPrBody: string;
}

function kindOf(k: OntologyProposalKind): ProposalKind {
  return k === OntologyProposalKind.RELATIONSHIP_TYPE ? 'relationship_type' : 'node_label';
}

function wireKind(k: ProposalKind): OntologyProposalKind {
  return k === 'relationship_type'
    ? OntologyProposalKind.RELATIONSHIP_TYPE
    : OntologyProposalKind.NODE_LABEL;
}

function statusOf(s: OntologyProposalStatus): ProposalStatus {
  switch (s) {
    case OntologyProposalStatus.PENDING:
      return 'pending';
    case OntologyProposalStatus.APPROVED:
      return 'approved';
    case OntologyProposalStatus.REJECTED:
      return 'rejected';
    default:
      return 'unspecified';
  }
}

/** Every proposal of the tenant, pending and decided. */
export async function daemonListOntologyProposals(): Promise<OntologyProposalDTO[]> {
  const resp = await userClient(OntologyExtensionService).listOntologyExtensionProposals({});
  return resp.ontologyProposals.map((p) => ({
    kind: kindOf(p.kind),
    label: p.label,
    recurrence: p.sightingCount,
    lastProposer: p.latestProposer,
    lastClaim: p.latestClaim,
    status: statusOf(p.status),
    reviewer: p.reviewer,
    rejectReason: p.rejectionReason,
    promoted: p.isPromoted,
    promotedTaxonomyVersion: p.taxonomyVersion,
  }));
}

export async function daemonApproveOntologyProposal(kind: ProposalKind, label: string): Promise<void> {
  await userClient(OntologyExtensionService).approveOntologyExtensionProposal({
    kind: wireKind(kind),
    label,
  });
}

export async function daemonRejectOntologyProposal(
  kind: ProposalKind,
  label: string,
  reason: string,
): Promise<void> {
  await userClient(OntologyExtensionService).rejectOntologyExtensionProposal({
    kind: wireKind(kind),
    label,
    reason,
  });
}

/** Render a promoted proposal as an SDK contribution and record it in the audit log. */
export async function daemonSubmitOntologyUpstream(
  kind: ProposalKind,
  label: string,
  idempotencyKey: string,
): Promise<UpstreamContributionDTO> {
  const resp = await userClient(OntologyExtensionService).submitOntologyExtensionUpstream({
    kind: wireKind(kind),
    label,
    idempotencyKey,
  });
  return {
    auditRecordId: resp.auditRecordId,
    packJson: new TextDecoder().decode(resp.fragmentJson),
    suggestedFilePath: resp.packFilePath,
    suggestedPrTitle: resp.pullRequestTitle,
    suggestedPrBody: resp.pullRequestBody,
  };
}
