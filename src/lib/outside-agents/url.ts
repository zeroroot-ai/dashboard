// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * A first check of the A2A URL in the form. The daemon decides: it also
 * resolves the host and refuses an address that is not public. This check
 * only saves a round trip for an input that cannot be valid.
 */
export function outsideAgentUrlError(url: string): string | null {
  const v = url.trim();
  if (v === "") return "The A2A URL is required.";
  if (v.length > 2048) return "The A2A URL must be at most 2048 characters.";
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return "The A2A URL is not a valid URL.";
  }
  if (parsed.protocol !== "https:") return "The A2A URL must use HTTPS.";
  return null;
}
