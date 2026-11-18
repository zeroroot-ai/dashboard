// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * A line diff for the body text of two Agent Skill versions.
 *
 * The function finds the longest common run of lines, then marks each other
 * line as removed (only in the old text) or added (only in the new text). It
 * has no dependency. The repo holds no diff library.
 */

type DiffLineKind = "same" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export type LineDiffResult =
  | { ok: true; lines: DiffLine[] }
  | { ok: false; reason: "too_large" };

/** The most lines that one side may hold. A larger text returns too_large. */
export const MAX_DIFF_LINES = 3000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // A final newline does not start a new line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Compare two texts line by line. */
export function diffLines(oldText: string, newText: string): LineDiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Trim the common start and end, so the table covers only the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length > MAX_DIFF_LINES || midB.length > MAX_DIFF_LINES) {
    return { ok: false, reason: "too_large" };
  }

  // lcs[i][j] is the length of the longest common run of midA[i..] and midB[j..].
  const n = midA.length;
  const m = midB.length;
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  for (let k = 0; k < start; k++) lines.push({ kind: "same", text: a[k] });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      lines.push({ kind: "same", text: midA[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      lines.push({ kind: "remove", text: midA[i++] });
    } else {
      lines.push({ kind: "add", text: midB[j++] });
    }
  }
  while (i < n) lines.push({ kind: "remove", text: midA[i++] });
  while (j < m) lines.push({ kind: "add", text: midB[j++] });
  for (let k = endA; k < a.length; k++) lines.push({ kind: "same", text: a[k] });
  return { ok: true, lines };
}
