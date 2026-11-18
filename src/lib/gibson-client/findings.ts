// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";
/**
 * Typed dashboard client for the finding calls of gibson.tenant.v1.TenantService
 * (gibson#1365): GetFinding returns one finding with all its evidence, and
 * ExportFindings returns a file. The list of findings holds no evidence.
 *
 * These functions do not flatten a ConnectError. The actions read the code.
 */
import { userClient } from "../gibson-client";
import { TenantService } from "@/src/gen/gibson/tenant/v1/tenant_pb";
import type { FindingDetail } from "@/src/gen/gibson/tenant/v1/tenant_pb";
import { EvidenceTier, EvidenceType } from "@/src/gen/gibson/types/v1/types_pb";
import type { Evidence } from "@/src/gen/gibson/types/v1/types_pb";

import type {
  EvidenceDTO,
  EvidenceKindDTO,
  EvidenceTierDTO,
  FindingDetailDTO,
  FindingsExportDTO,
} from "./finding-types";

const KINDS: Partial<Record<EvidenceType, EvidenceKindDTO>> = {
  [EvidenceType.REQUEST]: "request",
  [EvidenceType.RESPONSE]: "response",
  [EvidenceType.SCREENSHOT]: "screenshot",
  [EvidenceType.CODE]: "code",
  [EvidenceType.LOG]: "log",
  [EvidenceType.OTHER]: "other",
  [EvidenceType.PAYLOAD]: "payload",
  [EvidenceType.CONVERSATION]: "conversation",
  [EvidenceType.NETWORK_TRACE]: "network_trace",
};

function tierOf(t: EvidenceTier): EvidenceTierDTO {
  if (t === EvidenceTier.RECORDED) return "recorded";
  if (t === EvidenceTier.TYPED) return "typed";
  return "unknown";
}

function toEvidenceDTO(e: Evidence): EvidenceDTO {
  return {
    title: e.title,
    kind: KINDS[e.type] ?? "unspecified",
    tier: tierOf(e.tier),
    toolCallId: e.toolCallId,
    content: e.content,
    metadata: { ...e.metadata },
  };
}

function isoOrEmpty(ts: FindingDetail["createdAt"]): string {
  if (!ts) return "";
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6);
  return new Date(ms).toISOString();
}

function toFindingDTO(f: FindingDetail): FindingDetailDTO {
  return {
    id: f.id,
    title: f.title,
    description: f.description,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    missionId: f.missionId,
    agentName: f.agentName,
    submittedBy: f.submittedBy,
    createdAt: isoOrEmpty(f.createdAt),
    // The order is the stored order. Do not sort.
    evidence: f.evidence.map(toEvidenceDTO),
  };
}

/** Read one finding with all its evidence. Null when the response holds no finding. */
export async function daemonGetFinding(findingId: string): Promise<FindingDetailDTO | null> {
  const resp = await userClient(TenantService).getFinding({ findingId });
  return resp.finding ? toFindingDTO(resp.finding) : null;
}

/** Export findings as a file. includeEvidence adds all evidence of each finding. */
export async function daemonExportFindings(input: {
  format: "json" | "csv" | "sarif";
  findingIds: string[];
  includeEvidence: boolean;
}): Promise<FindingsExportDTO> {
  const resp = await userClient(TenantService).exportFindings({
    format: input.format,
    findingIds: input.findingIds,
    includeEvidence: input.includeEvidence,
  });
  return {
    filename: resp.filename,
    format: resp.format,
    count: resp.count,
    text: new TextDecoder().decode(resp.data),
  };
}
