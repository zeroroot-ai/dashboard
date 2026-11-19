// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * LineDiffView. It shows the lines of a diff as plain text. An added line
 * starts with "+" and a removed line starts with "-", so the sign tells the
 * change without a color.
 */

import type { DiffLine } from "@/src/lib/agent-skills/line-diff";

const SIGN = { same: " ", add: "+", remove: "-" } as const;
const TONE = {
  same: "text-muted-foreground",
  add: "bg-highlight/10 text-highlight",
  remove: "bg-destructive/10 text-destructive",
} as const;

export function LineDiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre
      data-testid="line-diff"
      className="bg-muted overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap"
    >
      {lines.map((l, i) => (
        <div key={i} data-kind={l.kind} className={TONE[l.kind]}>
          {`${SIGN[l.kind]} ${l.text}`}
        </div>
      ))}
    </pre>
  );
}
