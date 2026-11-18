// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Map an error from an Agent Skill RPC to a result for the browser.
 *
 * A rejected publish carries a reason that the publisher can fix: a tag
 * instead of a digest, a folder that fails validation, a registry that
 * refuses the credential. The generic server action mapper hides the daemon
 * text. This mapper shows it for the codes below, as the mission and agent
 * permission actions do. Any other failure takes the generic mapper, so
 * internal detail never reaches the browser.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

export type AgentSkillFailure = { ok: false; error: string; code?: string };

/** The codes whose daemon message the publisher may read. */
const SHOWN_CODES: ReadonlyMap<Code, string> = new Map([
  [Code.InvalidArgument, "invalid_argument"],
  [Code.FailedPrecondition, "failed_precondition"],
  [Code.NotFound, "not_found"],
  [Code.AlreadyExists, "already_exists"],
]);

export function agentSkillFailure(err: unknown, action: string): AgentSkillFailure {
  const denied = permissionDeniedResult(err);
  if (denied) return denied;
  if (err instanceof ConnectError) {
    const code = SHOWN_CODES.get(err.code);
    const message = err.rawMessage.trim();
    const provisioning = /tenant data.?plane not provisioned/i.test(message);
    if (code !== undefined && message !== "" && !provisioning) {
      return { ok: false, error: message, code };
    }
  }
  return serverActionError(err, { action });
}
