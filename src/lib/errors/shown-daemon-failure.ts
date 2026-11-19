// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Map an error from a daemon RPC of a form to a result for the browser.
 *
 * A rejected save carries a reason that the person can fix: a tag
 * instead of a digest, a folder that fails validation, a registry that
 * refuses the credential. The generic server action mapper hides the daemon
 * text. This mapper shows it for the codes below, as the mission and agent
 * permission actions do. Any other failure takes the generic mapper, so
 * internal detail never reaches the browser. The refusal of a host is the
 * exception among the shown codes: its text holds resolved addresses, so the
 * browser gets a fixed message.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { ADDRESS_REFUSED_MESSAGE, isAddressRefusal } from "@/src/lib/errors/address-refusal";
import { serverActionError } from "@/src/lib/errors/server-action-error";

export type ShownDaemonFailure = { ok: false; error: string; code?: string };

/** The codes whose daemon message the publisher may read. */
const SHOWN_CODES: ReadonlyMap<Code, string> = new Map([
  [Code.InvalidArgument, "invalid_argument"],
  [Code.FailedPrecondition, "failed_precondition"],
  [Code.NotFound, "not_found"],
  [Code.AlreadyExists, "already_exists"],
]);

export function shownDaemonFailure(err: unknown, action: string): ShownDaemonFailure {
  const denied = permissionDeniedResult(err);
  if (denied) return denied;
  if (err instanceof ConnectError) {
    const code = SHOWN_CODES.get(err.code);
    const message = err.rawMessage.trim();
    const provisioning = /tenant data.?plane not provisioned/i.test(message);
    // A refused host holds resolved addresses. The browser gets a fixed text.
    if (code !== undefined && isAddressRefusal(message)) {
      return { ok: false, error: ADDRESS_REFUSED_MESSAGE, code };
    }
    if (code !== undefined && message !== "" && !provisioning) {
      return { ok: false, error: message, code };
    }
  }
  return serverActionError(err, { action });
}
