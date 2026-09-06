// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

export type InstallAction = "read" | "write" | "execute";

export interface InstallApproval {
  /** Target reference, e.g. "component:plugin/gitlab". */
  target: string;
  action: InstallAction;
  /** From the manifest, used for error messaging only. */
  required: boolean;
}

export interface InstallAgentInput {
  agentSlug: string;
  componentYaml: string;
  permissionsYaml: string;
  approvals: InstallApproval[];
}
