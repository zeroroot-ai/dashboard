// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * mailpit.ts, reads a delivered email from the Mailpit sink of a kind
 * cluster.
 *
 * The kind venues of the exit tests deliver mail to Mailpit, and the hosted
 * signup and Platform owner tests read it the same way
 * (zeroroot-ai/hosted test/platform-owner/driver.mjs). Staging delivers real
 * mail, so a spec that needs a delivered email calls `requireMailpit()` and
 * skips with a reason on a venue that has no sink.
 *
 * Variable: E2E_MAILPIT_URL, the base URL of the Mailpit HTTP API.
 */

import { test } from "@playwright/test";

export const MAILPIT_SKIP_REASON =
  "E2E_MAILPIT_URL is not set. This spec reads a delivered email and runs on a venue with a Mailpit sink";

/** The Mailpit base URL, or a skip of the current test when it is not set. */
export function requireMailpit(): string {
  const url = process.env.E2E_MAILPIT_URL?.replace(/\/+$/, "");
  test.skip(!url, MAILPIT_SKIP_REASON);
  return url as string;
}

interface MailpitAddress {
  Address: string;
}

interface MailpitSummary {
  ID: string;
  To: MailpitAddress[];
  Created: string;
}

/**
 * Polls Mailpit until a message to `address` holds a link that `pick`
 * accepts, newest message first. A message with no such link is passed
 * over, so an unrelated email to the same address never matches.
 */
export async function waitForLink(
  mailpitURL: string,
  address: string,
  pick: (url: URL) => boolean,
  timeoutMs = 120_000,
): Promise<URL> {
  const deadline = Date.now() + timeoutMs;
  const wanted = address.toLowerCase();
  while (Date.now() < deadline) {
    const resp = await fetch(`${mailpitURL}/api/v1/messages?limit=200`).catch(() => null);
    if (resp?.ok) {
      const body = (await resp.json()) as { messages?: MailpitSummary[] };
      const mine = (body.messages ?? [])
        .filter((m) => m.To.some((to) => to.Address.toLowerCase() === wanted))
        .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
      for (const m of mine) {
        const full = (await fetch(`${mailpitURL}/api/v1/message/${m.ID}`).then((r) => r.json())) as {
          Text?: string;
          HTML?: string;
        };
        const link = firstLink(`${full.Text ?? ""}\n${full.HTML ?? ""}`, pick);
        if (link) return link;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`no email with a matching link reached ${address} within ${timeoutMs / 1000}s`);
}

/** The first URL in `body` that `pick` accepts. */
export function firstLink(body: string, pick: (url: URL) => boolean): URL | null {
  for (const raw of body.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
    let url: URL;
    try {
      url = new URL(raw.replace(/&amp;/g, "&").replace(/[.,)\]]+$/, ""));
    } catch {
      continue;
    }
    if (pick(url)) return url;
  }
  return null;
}
