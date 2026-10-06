// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The visible text of the secret access step of the deploy wizard
 * (dashboard#174). The owner has not approved these strings yet. They are on
 * the approval list in release/final-session.md of the docs repository.
 * Change them only there.
 */
export const SECRET_ACCESS_TEXTS = {
  heading: "Secret access",
  description:
    "Select the secrets of this workspace that the plugin can read. The plugin can read no other secret. You can select none.",
  loading: "Loading the secrets of this workspace…",
  loadError: "We could not load the secrets of this workspace.",
  empty: "This workspace has no secrets. The plugin can read no secret.",
  summary: (n: number) =>
    n === 0 ? "The plugin can read no secret." : `The plugin can read ${n} secret${n === 1 ? "" : "s"}.`,
  guideLink: "How platform plugins ship through GitOps",
} as const;
