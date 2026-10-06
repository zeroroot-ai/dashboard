// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the track record panel (dashboard#192, gibson#619).
 *
 * Written in the style of the approved texts (D25, D55, D56, D65). The
 * lane 11 detail file lists each one for the owner.
 */

export const TRACK_RECORD_TEXT = {
  title: "Track record",
  intro:
    "How often bets of this technique came true in one scope. A new hypothesis of this technique in this scope starts from this value.",
  scopeLabel: "Scope",
  scopePlaceholder: "Choose a scope",
  noScopes: "The World holds no scope yet.",
  barLabel: "Prior strength",
  noTrackRecord:
    "No track record yet. No bet of this technique has settled in this scope, so a new hypothesis starts from the neutral prior.",
  loadFailed: "The track record did not load.",
} as const;
