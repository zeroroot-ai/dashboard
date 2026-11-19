// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The daemon refuses the host of an outside agent URL and of a model provider
 * base_url when the host resolves to an address that is not public. Its
 * InvalidArgument text then holds the resolved addresses and DNS detail. That
 * detail lets a tenant map the internal network, so the browser gets a fixed
 * message in place of it.
 *
 * The daemon sends no code and no reason for this refusal. The stable part is
 * the phrase "host is refused", which both checks use.
 */

const ADDRESS_REFUSAL = /\bhost is refused\b/i;

/** The message that the browser gets for a refused host. */
export const ADDRESS_REFUSED_MESSAGE =
  "The host of this address is refused. Use a host with a public address.";

/** True when a daemon message is the refusal of a host. */
export function isAddressRefusal(daemonMessage: string): boolean {
  return ADDRESS_REFUSAL.test(daemonMessage);
}
