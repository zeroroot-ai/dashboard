export type InstallAction = "read" | "write" | "execute";

export interface InstallApproval {
  /** Target reference, e.g. "component:plugin/gitlab". */
  target: string;
  action: InstallAction;
  /** From the manifest — used for error messaging only. */
  required: boolean;
}

export interface InstallAgentInput {
  agentSlug: string;
  componentYaml: string;
  permissionsYaml: string;
  approvals: InstallApproval[];
}
