"use client";

import { useEffect } from "react";

/**
 * Per-route error boundary for /docs/*.
 *
 * A render crash on one MDX page is contained here — the docs shell
 * (header + sidebar) stays mounted and the visitor can recover via the
 * reset button or navigate to another page via the sidebar.
 *
 * No analytics / Sentry call site is wired from this file; the app-level
 * error reporter (if any) already captures the stack before this fires.
 */
export default function DocsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the browser console for local debugging.
    // Production telemetry (Langfuse / Sentry) is wired at the app root,
    // not here — this boundary is a UX-only concern.
    // eslint-disable-next-line no-console
    console.error("Docs page error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16 font-mono">
      <h1 className="text-2xl font-bold text-highlight">
        Something went wrong rendering this page
      </h1>
      <p className="text-sm text-muted-foreground">
        A one-off render error was caught. The rest of <code>/docs</code>
        {" "}is unaffected; try again or pick another page from the sidebar.
      </p>
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded-md border border-highlight/25 bg-card px-4 py-2 text-sm text-highlight hover:border-highlight/50"
      >
        Try again
      </button>
    </div>
  );
}
