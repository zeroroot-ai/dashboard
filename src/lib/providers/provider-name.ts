// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The rule for the name of a provider (gibson#1394). The name becomes a
 * Kubernetes object name on the model gateway, so it must be a valid
 * Kubernetes name: lowercase letters, digits and hyphens, at most 63
 * characters, and it starts and ends with a letter or a digit.
 */

export const PROVIDER_NAME_MAX_LENGTH = 63;

const PROVIDER_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** The reason that a name is not valid, or null when it is valid. */
export function providerNameError(name: string): string | null {
  if (name === "") return "Name is required";
  if (name.length > PROVIDER_NAME_MAX_LENGTH) {
    return `Use at most ${PROVIDER_NAME_MAX_LENGTH} characters`;
  }
  if (!PROVIDER_NAME_PATTERN.test(name)) {
    return "Use lowercase letters, digits and hyphens. Start and end with a letter or a digit.";
  }
  return null;
}
