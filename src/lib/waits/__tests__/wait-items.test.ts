// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import {
  formatWait,
  sortByLongestWait,
  summarizeWaits,
  waitItemsFromApi,
  type WaitingItemDto,
  waitMs,
} from "../wait-items";
import type { PendingDestructiveAction } from "@/src/types/destructive-actions";

const NOW = new Date("2026-11-20T12:00:00.000Z").getTime();

function action(id: string, requestedAt: string, over: Partial<PendingDestructiveAction> = {}): PendingDestructiveAction {
  return {
    id,
    missionId: "m",
    scopeId: "s",
    hypothesisId: `h-${id}`,
    technique: `tech-${id}`,
    predicateType: "p",
    blastRadius: "",
    reversibility: "unspecified",
    requestedAt,
    ...over,
  };
}

function dto(kind: string, id: string, since: string): WaitingItemDto {
  return { kind, id, since, waitedSeconds: 0 };
}

/** The wait items of destructive actions, with the details from the queue. */
function waitItemsFromDestructiveActions(actions: PendingDestructiveAction[]) {
  return waitItemsFromApi(
    actions.map((a) => dto("destructive_action", a.hypothesisId, a.requestedAt)),
    actions,
  );
}

describe("waitItemsFromApi", () => {
  it("makes a destructive-action item with the details of the queue and links to the queue page", () => {
    const [item] = waitItemsFromApi(
      [dto("destructive_action", "h1", "2026-11-20T10:00:00.000Z")],
      [action("a1", "x", { hypothesisId: "h1", blastRadius: "one host", reversibility: "irreversible" })],
    );
    expect(item).toMatchObject({
      kind: "destructive-action",
      id: "destructive-action:h1",
      title: "tech-a1",
      href: "/dashboard/destructive-actions",
      blastRadius: "one host",
      reversibility: "irreversible",
    });
    expect(waitMs(item, NOW)).toBe(2 * 3600_000);
  });

  it("keeps a destructive action that is not in the queue, with unknown details", () => {
    const [item] = waitItemsFromApi([dto("destructive_action", "h9", "")], []);
    expect(item).toMatchObject({ title: "h9", blastRadius: "", reversibility: "unspecified" });
  });

  it("makes the three kinds of a finding and links each to the finding", () => {
    const items = waitItemsFromApi(
      [
        dto("merge_refused", "f/1", "2026-11-20T11:00:00.000Z"),
        dto("next_scan", "f2", ""),
        dto("no_health_signal", "f3", ""),
      ],
      [],
    );
    expect(items.map((i) => i.kind)).toEqual(["merge-refused", "awaiting-scan", "no-health-signal"]);
    expect(items[0].href).toBe("/dashboard/findings/f%2F1");
  });

  it("drops a kind that it does not know", () => {
    expect(waitItemsFromApi([dto("new_kind", "x", "")], [])).toEqual([]);
  });

  it("gives an unknown start time for an empty or invalid timestamp", () => {
    const items = waitItemsFromDestructiveActions([action("a", ""), action("b", "not a date")]);
    expect(items.map((i) => i.waitStartedAtMs)).toEqual([null, null]);
  });
});

describe("sorting and summary", () => {
  const items = waitItemsFromDestructiveActions([
    action("new", "2026-11-20T11:30:00.000Z"),
    action("unknown", ""),
    action("old", "2026-11-18T12:00:00.000Z"),
  ]);

  it("puts the longest wait first and the unknown wait last", () => {
    expect(sortByLongestWait(items, NOW).map((i) => i.title)).toEqual([
      "tech-old",
      "tech-new",
      "tech-unknown",
    ]);
  });

  it("counts every item and takes the oldest known wait", () => {
    expect(summarizeWaits(items, NOW)).toEqual({ count: 3, oldestMs: 2 * 24 * 3600_000 });
  });

  it("gives a null oldest wait when no item has a known start", () => {
    expect(summarizeWaits(waitItemsFromDestructiveActions([action("u", "")]), NOW)).toEqual({
      count: 1,
      oldestMs: null,
    });
    expect(summarizeWaits([], NOW)).toEqual({ count: 0, oldestMs: null });
  });

  it("never gives a negative wait", () => {
    const [future] = waitItemsFromDestructiveActions([action("f", "2026-11-20T13:00:00.000Z")]);
    expect(waitMs(future, NOW)).toBe(0);
  });
});

describe("formatWait", () => {
  it("uses at most two units", () => {
    expect(formatWait(10_000)).toBe("less than 1 minute");
    expect(formatWait(5 * 60_000)).toBe("5 min");
    expect(formatWait(3600_000)).toBe("1 h");
    expect(formatWait(3600_000 + 7 * 60_000)).toBe("1 h 7 min");
    expect(formatWait(26 * 3600_000 + 59 * 60_000)).toBe("1 d 2 h");
    expect(formatWait(48 * 3600_000)).toBe("2 d");
  });
});
