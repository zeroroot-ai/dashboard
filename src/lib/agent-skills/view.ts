// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Pure helpers that the Agent Skill pages share. They have no transport.
 */
const SHORT_DIGEST_HEX = 12;

/** Show a digest as sha256:<first 12 hex characters>. Other text stays as is. */
export function shortDigest(digest: string): string {
  const m = /^(sha256:)([0-9a-f]{64})$/i.exec(digest);
  if (!m) return digest;
  return `${m[1]}${m[2].slice(0, SHORT_DIGEST_HEX)}`;
}

/** Format an ISO time for a table cell. An unreadable value shows as is. */
export function formatPublishedAt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
