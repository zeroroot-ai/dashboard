// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the Agent Skill pages (epic gibson#1364).
 *
 * Plain words, sentence case, American spelling. The name is always
 * "Agent Skill", never the bare word "skill".
 */

export const AGENT_SKILL_TEXT = {
  menu: "Agent Skills",
  title: "Agent Skills",
  intro:
    "An Agent Skill is a folder of instructions that an agent can load. Publish one from an OCI image, then grant it to an agent or to a mission.",
  loadError: "The Agent Skills could not be loaded.",
  tryAgain: "Try again",
  loading: "Loading Agent Skills...",

  tabMine: "Your Agent Skills",
  tabShared: "Shared Agent Skills",

  empty: "Your workspace has no Agent Skill. Publish one to start.",
  columnName: "Name",
  columnDescription: "Description",
  columnDigest: "Current digest",
  columnPublished: "Published",
  columnSource: "Source",
  sourceTenant: "Your workspace",
  sourceShared: "Shared",

  publishTitle: "Publish an Agent Skill",
  publishIntro:
    "Give the name and the OCI reference of the image. The reference must name a digest. A tag is not valid.",
  fieldName: "Name",
  fieldReference: "OCI reference",
  referencePlaceholder: "registry.example.com/team/my-skill@sha256:...",
  fieldRegistrySecret: "Registry secret",
  registrySecretNone: "None (pull without a credential)",
  registrySecretHelp:
    "Choose a secret that holds the registry credential. Leave it empty if the registry is public.",
  publishButton: "Publish",
  publishing: "Publishing...",
  published: (name: string) => `${name} is published.`,
  publishFailed: "The Agent Skill was not published.",

  sharedIntro:
    "The operator of this platform offers these Agent Skills. Enable one to copy it into your workspace. Enabling does not grant it to any agent.",
  sharedEmpty: "The operator offers no Shared Agent Skill.",
  columnEnabled: "State",
  stateEnabled: "Enabled",
  stateNotEnabled: "Not enabled",
  enableButton: "Enable",
  enabling: "Enabling...",
  enabled: (name: string) => `${name} is enabled. Grant it to an agent or a mission to use it.`,
  enableFailed: "The Shared Agent Skill was not enabled.",

  back: "Agent Skills",
  detailLoadError: "The Agent Skill could not be loaded.",
  notFound: "This Agent Skill has no version with this digest.",
  currentVersion: "Current version",
  version: "Version",
  bodyTitle: "SKILL.md",
  bodyHelp: "This text comes from the publisher. Treat it as untrusted.",
  bodyRendered: "Formatted",
  bodyPlain: "Plain text",
  bodyEmpty: "SKILL.md has no body text.",
  filesTitle: "Files",
  filesEmpty: "This version holds no file besides SKILL.md.",
  columnPath: "Path",
  columnSize: "Size",
  detailsTitle: "Details",
  fieldReferenceShown: "Reference",
  fieldDigestShown: "Digest",
  fieldLicense: "License",
  fieldCompatibility: "Compatibility",
  fieldAllowedTools: "Allowed tools",

  versionsTitle: "Versions",
  versionsEmpty: "No version was found.",
  currentBadge: "Current",
  viewVersion: "View",

  diffTitle: "Compare two versions",
  diffIntro: "Choose two digests to see the line changes in the SKILL.md body.",
  diffFrom: "From",
  diffTo: "To",
  diffButton: "Compare",
  diffSame: "The two bodies are the same.",
  diffTooLarge: "The bodies are too long to compare here.",
  diffFailed: "The versions could not be compared.",
  diffAdded: "Added",
  diffRemoved: "Removed",

  grantsTitle: "Grants",
  grantsIntro:
    "No agent or mission can load an Agent Skill until you grant it. Enter the id of the agent or of the mission.",
  fieldSubjectKind: "Grant to",
  kindAgent: "An agent",
  kindMission: "A mission",
  fieldSubjectId: "Agent or mission id",
  grantButton: "Grant",
  revokeButton: "Revoke",
  granted: "The grant is saved.",
  revoked: "The grant is removed.",
  grantFailed: "The grant was not saved.",
  revokeFailed: "The grant was not removed.",

  deleteButton: "Delete Agent Skill",
  deleteTitle: "Delete this Agent Skill?",
  deleteBody:
    "This removes each version of the Agent Skill and each grant of it. Agents that use it lose access.",
  deleteConfirm: "Delete",
  cancel: "Cancel",
  deleted: (name: string) => `${name} is deleted.`,
  deleteFailed: "The Agent Skill was not deleted.",

  sessionExpired: "Your session expired. Sign in again to continue.",
  denied: "You do not have permission to manage Agent Skills.",
} as const;
