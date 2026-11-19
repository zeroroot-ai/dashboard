// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import { diffLines, MAX_DIFF_LINES, type DiffLine } from "../line-diff";

function lines(r: ReturnType<typeof diffLines>): DiffLine[] {
  if (!r.ok) throw new Error("the diff was too large");
  return r.lines;
}

describe("diffLines", () => {
  it("marks every line of equal texts as same", () => {
    expect(lines(diffLines("a\nb\nc", "a\nb\nc"))).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("marks an added line", () => {
    expect(lines(diffLines("a\nc", "a\nb\nc"))).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("marks a removed line", () => {
    expect(lines(diffLines("a\nb\nc", "a\nc"))).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("shows a changed line as one removal and one addition", () => {
    const out = lines(diffLines("a\nold\nc", "a\nnew\nc"));
    expect(out.filter((l) => l.kind === "remove")).toEqual([{ kind: "remove", text: "old" }]);
    expect(out.filter((l) => l.kind === "add")).toEqual([{ kind: "add", text: "new" }]);
    expect(out.filter((l) => l.kind === "same").map((l) => l.text)).toEqual(["a", "c"]);
  });

  it("handles an empty old text and an empty new text", () => {
    expect(lines(diffLines("", "a\nb"))).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
    ]);
    expect(lines(diffLines("a\nb", ""))).toEqual([
      { kind: "remove", text: "a" },
      { kind: "remove", text: "b" },
    ]);
    expect(lines(diffLines("", ""))).toEqual([]);
  });

  it("treats CRLF and LF as the same line break, and ignores one final newline", () => {
    expect(lines(diffLines("a\r\nb\r\n", "a\nb\n")).every((l) => l.kind === "same")).toBe(true);
  });

  it("keeps the order of the new text when it moves a block", () => {
    const out = lines(diffLines("a\nb\nc\nd", "c\nd\na\nb"));
    const rebuilt = out.filter((l) => l.kind !== "remove").map((l) => l.text);
    expect(rebuilt).toEqual(["c", "d", "a", "b"]);
    const original = out.filter((l) => l.kind !== "add").map((l) => l.text);
    expect(original).toEqual(["a", "b", "c", "d"]);
  });

  it("returns too_large when the changed part is over the cap", () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `x${i}`).join("\n");
    const other = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `y${i}`).join("\n");
    expect(diffLines(big, other)).toEqual({ ok: false, reason: "too_large" });
  });

  it("does not count the common start and end against the cap", () => {
    const common = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `c${i}`);
    const a = [...common, "old"].join("\n");
    const b = [...common, "new"].join("\n");
    const r = diffLines(a, b);
    expect(r.ok).toBe(true);
  });
});
