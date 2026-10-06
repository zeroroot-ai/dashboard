// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment node
 *
 * The ontology proposal client (dashboard#191, gibson#618): it reads every
 * restored proposal field and the upstream contribution fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { list, approve, reject, submit } = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('../../gibson-client', () => ({
  userClient: () => ({
    listOntologyExtensionProposals: list,
    approveOntologyExtensionProposal: approve,
    rejectOntologyExtensionProposal: reject,
    submitOntologyExtensionUpstream: submit,
  }),
}));

import {
  daemonApproveOntologyProposal,
  daemonListOntologyProposals,
  daemonRejectOntologyProposal,
  daemonSubmitOntologyUpstream,
} from '../ontology-proposals';
import {
  OntologyProposalKind,
  OntologyProposalStatus,
} from '@/src/gen/gibson/tenant/v1/ontology_extension_pb';

beforeEach(() => {
  list.mockReset();
  approve.mockReset();
  reject.mockReset();
  submit.mockReset();
});

describe('ontology proposal client', () => {
  it('maps every proposal field', async () => {
    list.mockResolvedValue({
      proposals: [
        {
          kind: OntologyProposalKind.RELATIONSHIP_TYPE,
          label: 'MANAGES',
          recurrence: 5,
          lastProposer: 'agent/recon',
          lastClaim: 'claim',
          status: OntologyProposalStatus.REJECTED,
          reviewer: 'owner',
          rejectReason: 'why',
          promoted: true,
          promotedTaxonomyVersion: 7,
        },
      ],
    });
    await expect(daemonListOntologyProposals()).resolves.toEqual([
      {
        kind: 'relationship_type',
        label: 'MANAGES',
        recurrence: 5,
        lastProposer: 'agent/recon',
        lastClaim: 'claim',
        status: 'rejected',
        reviewer: 'owner',
        rejectReason: 'why',
        promoted: true,
        promotedTaxonomyVersion: 7,
      },
    ]);
  });

  it('sends the wire kind with each decision', async () => {
    approve.mockResolvedValue({});
    reject.mockResolvedValue({});
    await daemonApproveOntologyProposal('node_label', 'Operator');
    await daemonRejectOntologyProposal('relationship_type', 'MANAGES', 'why');
    expect(approve).toHaveBeenCalledWith({ kind: OntologyProposalKind.NODE_LABEL, label: 'Operator' });
    expect(reject).toHaveBeenCalledWith({
      kind: OntologyProposalKind.RELATIONSHIP_TYPE,
      label: 'MANAGES',
      reason: 'why',
    });
  });

  it('decodes the contribution', async () => {
    submit.mockResolvedValue({
      auditRecordId: '42',
      packJson: new TextEncoder().encode('{"name":"MANAGES"}'),
      suggestedFilePath: 'packs/manages.json',
      suggestedPrTitle: 'title',
      suggestedPrBody: 'body',
    });
    await expect(daemonSubmitOntologyUpstream('relationship_type', 'MANAGES', 'k1')).resolves.toEqual({
      auditRecordId: '42',
      packJson: '{"name":"MANAGES"}',
      suggestedFilePath: 'packs/manages.json',
      suggestedPrTitle: 'title',
      suggestedPrBody: 'body',
    });
    expect(submit).toHaveBeenCalledWith({
      kind: OntologyProposalKind.RELATIONSHIP_TYPE,
      label: 'MANAGES',
      idempotencyKey: 'k1',
    });
  });
});
