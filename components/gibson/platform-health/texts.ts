// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The visible text of the platform health view (hosted#174). The owner has
 * not approved these strings yet. They are on the approval list in
 * release/final-session.md of the docs repository. Change them only there.
 */
export const PLATFORM_HEALTH_TEXTS = {
  menu: "Platform health",
  title: "Platform health",
  intro:
    "The platform asks each plane to answer when you open this page. A plane that does not answer is red, even when every pod runs.",
  planes: {
    secret_plane: "Secret source",
  } as Record<string, string>,
  state: {
    healthy: "Answering",
    unhealthy: "Not answering",
    unknown: "Not checked",
  },
  checkedAt: "Checked",
  loadError: "We could not read the platform health.",
  secretPlaneHint:
    "Pods keep running on the secrets that were written earlier. A restart, a rotation or a new pod gets no secret until the source answers again. Runbook: secret-plane-stale.",
} as const;
