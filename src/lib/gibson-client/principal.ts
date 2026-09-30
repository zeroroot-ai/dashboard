// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { Principal, Principal_Kind } from '@/src/gen/gibson/common/v1/gibson_common_pb';
import type { PrincipalView } from '@/src/lib/banks/view';

/**
 * The one reading of a wire Principal. Banks record their owner, jobs who
 * opened them and who sent each input, missions who created them: every
 * caller renders the same shape through this function.
 */
export function principalView(p: Principal | undefined): PrincipalView {
  if (!p) return { kind: 'unknown', id: '' };
  switch (p.kind) {
    case Principal_Kind.USER:
      return { kind: 'user', id: p.id };
    case Principal_Kind.TENANT:
      return { kind: 'tenant', id: p.id };
    case Principal_Kind.COMPONENT:
      return { kind: 'component', id: p.id };
    case Principal_Kind.SERVICE:
      return { kind: 'service', id: p.id };
    default:
      return { kind: 'unknown', id: p.id };
  }
}

/**
 * A finding names its submitter as an FGA user reference ("user:<id>" for a
 * person, "agent_principal:<id>" and friends for a component). Read it into
 * the same view a wire Principal gives.
 */
export function principalViewFromRef(ref: string | undefined): PrincipalView | undefined {
  if (!ref) return undefined;
  if (ref.startsWith('user:')) return { kind: 'user', id: ref.slice('user:'.length) };
  if (/^(agent|tool|plugin)_principal:/.test(ref)) return { kind: 'component', id: ref };
  return { kind: 'unknown', id: ref };
}
