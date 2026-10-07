// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/** The state of one platform plane, as the health view shows it. */
export type PlaneStateView = "healthy" | "unhealthy" | "unknown";

/** One line of the platform health view. */
export interface PlaneHealthView {
  plane: string;
  state: PlaneStateView;
  detail: string;
  checkedAtUnix: number;
}
