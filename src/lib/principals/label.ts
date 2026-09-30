// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import type { PrincipalView } from '@/src/lib/banks/view';

/** What the daemon knows about a user id, from UserService.ResolveUsers. */
export interface UserRefView {
  userId: string;
  /** "member" of the caller's tenant, or "removed": not a member any more, no name. */
  state: 'member' | 'removed';
  displayName: string;
  email: string;
}

/** Name shown for a person who is no longer a member of the tenant (hosted#205). */
export const REMOVED_USER_LABEL = 'removed user';

/**
 * Short text for a principal: "me" for the signed-in person, the resolved
 * name for another member, "removed user" for a person who left the tenant,
 * and the id while the resolution is still loading.
 */
export function principalLabel(
  p: PrincipalView,
  myUserId: string | null,
  refs: ReadonlyMap<string, UserRefView> | undefined,
): string {
  if (p.kind === 'user') {
    if (p.id === myUserId) return 'me';
    const ref = refs?.get(p.id);
    if (!ref) return `user ${p.id}`;
    if (ref.state === 'removed') return REMOVED_USER_LABEL;
    return ref.displayName || ref.email || `user ${p.id}`;
  }
  if (p.kind === 'component') return `component ${p.id}`;
  if (p.kind === 'service') return 'platform';
  if (p.kind === 'tenant') return 'tenant';
  return p.id || 'unknown';
}

/** The user ids a list of principals needs resolved, distinct, without mine. */
export function userIdsToResolve(principals: (PrincipalView | undefined)[], myUserId: string | null): string[] {
  const out = new Set<string>();
  for (const p of principals) {
    if (p?.kind === 'user' && p.id && p.id !== myUserId) out.add(p.id);
  }
  return [...out].sort();
}
