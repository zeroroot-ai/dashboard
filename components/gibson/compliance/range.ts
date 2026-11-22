// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/** yyyy-mm-dd of a local date. */
export function dayString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The ISO range for two local days: the start day, through the end day. */
export function rangeOf(startDay: string, endDay: string): { start: string; end: string } {
  const start = new Date(`${startDay}T00:00:00`);
  const end = new Date(`${endDay}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
