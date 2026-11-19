// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the outside agent pages (epic gibson#1366, gibson#1403).
 * Plain words, sentence case, American spelling.
 */

export const OUTSIDE_AGENT_TEXT = {
  menu: "Outside agents",
  title: "Outside agents",
  intro:
    "An outside agent is an A2A agent that runs outside Gibson. Register its name and its HTTPS address. Then grant it to a mission. A mission with no grant cannot call it.",
  loadError: "The outside agents could not be loaded.",
  loading: "Loading outside agents...",
  empty: "Your workspace has no outside agent. Register one to start.",

  columnName: "Name",
  columnUrl: "A2A URL",
  columnDescription: "Description",
  columnCreated: "Registered",

  registerTitle: "Register an outside agent",
  registerIntro:
    "The address must use HTTPS and must resolve to a public address. To change a record, delete it and register it again.",
  fieldName: "Name",
  nameHelp: "Use lowercase letters, digits and hyphens, at most 63 characters.",
  fieldUrl: "A2A URL",
  urlPlaceholder: "https://agent.example.com/a2a",
  fieldCredential: "Credential secret",
  credentialHelp: "Choose the secret that holds the credential of the agent. Leave it empty if the agent needs none.",
  fieldCaBundle: "CA bundle secret",
  caBundleHelp:
    "Choose the secret that holds the PEM CA bundle of the agent. Leave it empty to use the public roots.",
  secretNone: "None",
  fieldDescription: "Description",
  registerButton: "Register",
  registering: "Registering...",
  registered: (name: string) => `${name} is registered.`,
  registerFailed: "The outside agent was not registered.",

  back: "Outside agents",
  detailLoadError: "The outside agent could not be loaded.",
  notFound: "This outside agent does not exist.",
  detailsTitle: "Details",
  fieldCreated: "Registered",
  none: "None",

  grantsTitle: "Missions with a grant",
  grantsIntro:
    "Only a mission with a grant can call this outside agent. Choose a mission, or enter its id.",
  grantsEmpty: "No mission has a grant for this outside agent.",
  grantsLoadError: "The grants could not be loaded.",
  grantsCut: (shown: number) => `The list is not complete. It shows the first ${shown} grants.`,
  columnMission: "Mission id",
  fieldMissionPick: "Mission",
  fieldMissionId: "Mission id",
  pickerNone: "Choose from the list",
  pickerEnterId: "Enter an id instead",
  pickerUseList: "Choose from the list instead",
  grantButton: "Grant",
  revokeButton: "Revoke",
  granted: "The grant is saved.",
  revoked: "The grant is removed.",
  grantFailed: "The grant was not saved.",
  revokeFailed: "The grant was not removed.",

  deleteButton: "Delete outside agent",
  deleteTitle: "Delete this outside agent?",
  deleteBody: "This removes the record and each grant of it. A mission that calls it loses access.",
  deleteConfirm: "Delete",
  cancel: "Cancel",
  deleted: (name: string) => `${name} is deleted.`,
  deleteFailed: "The outside agent was not deleted.",

  sessionExpired: "Your session expired. Sign in again to continue.",
} as const;
