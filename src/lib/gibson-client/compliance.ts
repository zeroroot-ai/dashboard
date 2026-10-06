// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';
/**
 * Typed dashboard client for gibson.tenant.v1.ComplianceService (ADR-0113,
 * gibson#674, gibson#886).
 *
 * ListComplianceEvidence returns, for the tenant of the caller, one enabled
 * framework pack and one time range, the audit events that are evidence for
 * each control. It returns evidence only, never a verdict. The RPC carries
 * the "admin" relation on the tenant: Owner and Admin may call it. It goes
 * through the user-acting transport (userClient), never a direct channel.
 */
import { ConnectError, Code } from '@connectrpc/connect';

import { userClient } from '../gibson-client';
import {
  ComplianceService,
  ControlEvidence_State,
} from '@/src/gen/gibson/tenant/v1/compliance_pb';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { daemonListDomainPacks } from './domain-packs';

/** The evidence state of one control. It is never a verdict. */
type ControlState = 'no_rule' | 'no_events' | 'has_evidence';

export interface ControlEvidenceDTO {
  controlId: string;
  title: string;
  family: string;
  familyTitle: string;
  state: ControlState;
  eventCount: number;
  /** ISO time of the last evidence event; empty when there is none. */
  lastEventTime: string;
}

export interface EvidenceEventDTO {
  auditRecordId: string;
  /** ISO time of the audit record. */
  time: string;
  action: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  controlIds: string[];
}

export interface ComplianceEvidenceDTO {
  pack: string;
  packVersion: number;
  controlsWithRule: number;
  controlsTotal: number;
  controls: ControlEvidenceDTO[];
  events: EvidenceEventDTO[];
}

/** The page size of one evidence read. The daemon allows up to 500. */
const EVENT_PAGE_SIZE = 500;

function iso(ts: Timestamp | undefined): string {
  if (!ts) return '';
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

function state(s: ControlEvidence_State): ControlState {
  switch (s) {
    case ControlEvidence_State.HAS_EVIDENCE:
      return 'has_evidence';
    case ControlEvidence_State.NO_EVENTS:
      return 'no_events';
    default:
      return 'no_rule';
  }
}

/**
 * Read the evidence of one pack in one range: the controls of the first page
 * (each page carries all of them) and the events of every page.
 */
export async function daemonListComplianceEvidence(input: {
  pack: string;
  start: Date;
  end: Date;
}): Promise<ComplianceEvidenceDTO> {
  const client = userClient(ComplianceService);
  let pageToken = '';
  let out: ComplianceEvidenceDTO | null = null;
  do {
    const resp = await client.listComplianceEvidence({
      pack: input.pack,
      startTime: timestampFromDate(input.start),
      endTime: timestampFromDate(input.end),
      pageSize: EVENT_PAGE_SIZE,
      pageToken,
    });
    if (!out) {
      out = {
        pack: resp.pack,
        packVersion: resp.packVersion,
        controlsWithRule: resp.controlsWithRule,
        controlsTotal: resp.controlsTotal,
        controls: resp.controls.map((c) => ({
          controlId: c.controlId,
          title: c.title,
          family: c.family,
          familyTitle: c.familyTitle,
          state: state(c.state),
          eventCount: Number(c.eventCount),
          lastEventTime: iso(c.lastEventTime),
        })),
        events: [],
      };
    }
    for (const e of resp.events) {
      out.events.push({
        auditRecordId: e.auditRecordId,
        time: iso(e.time),
        action: e.action,
        actorId: e.actorId,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        controlIds: [...e.controlIds],
      });
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  if (!out) throw new Error('ListComplianceEvidence returned no page');
  return out;
}

/**
 * The enabled packs of the tenant that are compliance frameworks.
 *
 * The domain-pack wire does not say which pack holds a control list, so each
 * enabled pack is asked for one event. The daemon answers NotFound for a
 * pack with no control list, and FailedPrecondition for a pack that is not
 * enabled; neither pack is a compliance pack of this tenant.
 */
export async function daemonListCompliancePacks(): Promise<string[]> {
  const enabled = await daemonListDomainPacks();
  const client = userClient(ComplianceService);
  // A one-second range: the probe reads at most one event.
  const end = new Date();
  const start = new Date(end.getTime() - 1000);
  const packs: string[] = [];
  for (const p of enabled) {
    try {
      await client.listComplianceEvidence({
        pack: p.name,
        startTime: timestampFromDate(start),
        endTime: timestampFromDate(end),
        pageSize: 1,
        pageToken: '',
      });
      packs.push(p.name);
    } catch (err) {
      if (
        err instanceof ConnectError &&
        (err.code === Code.NotFound || err.code === Code.FailedPrecondition)
      ) {
        continue;
      }
      throw err;
    }
  }
  return packs;
}
