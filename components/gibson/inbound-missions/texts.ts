// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the inbound missions page (epic gibson#1367, gibson#1408).
 * Plain words, sentence case, American spelling.
 */

export const INBOUND_MISSION_TEXT = {
  menu: "Inbound missions",
  title: "Inbound missions",
  intro:
    "An outside A2A client can start a mission that you publish here. The mission definition fixes the budget and the scope. You approve the targets. Each caller gets a new identity that can call only this one definition.",
  loadError: "The published definitions could not be loaded.",
  empty: "Your workspace has no published definition. Publish one to start.",

  columnAgent: "Agent",
  columnDefinition: "Mission definition",
  columnTargets: "Approved targets",
  columnMaxMissions: "Missions at one time",
  columnPublishedBy: "Published by",
  columnCreated: "Published",

  publishTitle: "Publish a mission definition",
  publishIntro:
    "Choose a mission definition, one of its agents and the targets that a call can use. The page makes a new identity for the caller, publishes the definition and grants the identity. To change a publication, unpublish it and publish it again.",
  optionsLoadError: "The mission definitions and the targets could not be loaded.",
  fieldDefinition: "Mission definition",
  definitionNone: "Choose a mission definition",
  noDefinitions: "Your workspace has no mission definition.",
  fieldAgent: "Agent",
  agentNone: "Choose an agent",
  agentHelp: "The outside client addresses this name. It must be an agent of the mission definition.",
  agentsLoading: "Loading the agents...",
  agentsLoadError: "The agents of the mission definition could not be loaded.",
  noAgents: "This mission definition has no agent.",
  fieldTargets: "Approved targets",
  targetsHelp: "A call can use only these targets. A message can narrow the list, and it cannot add a target.",
  noTargets: "Your workspace has no target. Add a target first.",
  fieldMaxMissions: "Maximum missions at one time",
  maxMissionsHelp:
    "The largest number of inbound missions of this publication that run or wait at one time. Enter a whole number from 1 to 10000.",
  fieldCallerName: "Name of the new caller identity",
  callerNameHelp: "Use lowercase letters, digits and hyphens, at most 63 characters.",
  publishButton: "Publish",
  publishing: "Publishing...",
  published: (agent: string) => `${agent} is published.`,
  publishFailed: "The definition was not published.",

  credentialsTitle: (name: string) => `Credentials of the caller ${name}`,
  credentialsIntro:
    "The caller enrolls with this token and then signs each call. The page shows the token one time.",

  failureTitle: "The page did not finish",
  failedIdentity: "The page could not make the identity of the caller.",
  failedPublish: "The page could not publish the definition.",
  failedGrant: "The page could not grant the identity to the definition.",
  identityNotMade: "No identity was made.",
  identityRemoved: (name: string) => `The page made the identity ${name} and then revoked it. Its token was not shown.`,
  identityLeft: (name: string, id: string) =>
    `The identity ${name} (${id}) exists and has no grant. The page could not revoke it. Its token was not shown.`,
  identityRevokeNote: (name: string, id: string) =>
    `The page made the identity ${name} (${id}). Its token was not shown. The revoke did not finish:`,
  retryRevokeButton: "Retry the revoke",
  retryingRevoke: "Revoking...",
  retryRevokeFailed: "The identity was not revoked.",
  identityRevokedNow: (name: string) => `The identity ${name} is revoked.`,
  definitionPublished: "The definition is published. Add a caller in the list below.",
  definitionNotPublished: "The definition is not published.",

  staleBadge: "Stale",
  staleBody:
    "The mission definition or an approved target changed after you published. The daemon refuses each inbound call. Examine the change, then publish again.",
  republishButton: "Publish again",
  republishTitle: "Publish this definition again?",
  republishBody:
    "This approves the mission definition and the targets as they are now. The callers keep their grants.",
  republishConfirm: "Publish again",
  republished: (agent: string) => `${agent} is published again.`,
  republishFailed: "The definition was not published again.",

  callersButton: "Callers",
  callersTitle: (agent: string) => `Callers of ${agent}`,
  callersIntro: "Only these identities can call this published definition.",
  callersLoading: "Loading the callers...",
  callersLoadError: "The callers could not be loaded.",
  callersCut: (shown: number) => `The list is not complete. It shows the first ${shown} callers.`,
  callersEmpty: "No identity can call this published definition.",
  columnCaller: "Caller",
  columnIdentityId: "Identity id",
  unknownCaller: "Unknown identity",
  revokeButton: "Revoke",
  revoked: "The caller is revoked.",
  revokeFailed: "The caller was not revoked.",
  addCallerButton: "Add a new caller",
  addingCaller: "Adding...",
  addCallerFailed: "The caller was not added.",
  callerAdded: (name: string) => `${name} can call this definition.`,

  unpublishButton: "Unpublish",
  unpublishTitle: "Unpublish this definition?",
  unpublishBody: "This removes the publication and the grant of each caller. An outside client can no longer call this agent.",
  unpublishConfirm: "Unpublish",
  cancel: "Cancel",
  unpublished: (agent: string) => `${agent} is unpublished.`,
  unpublishFailed: "The definition was not unpublished.",

  sessionExpired: "Your session expired. Sign in again to continue.",
} as const;
