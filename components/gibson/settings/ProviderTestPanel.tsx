// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * ProviderTestPanel (gibson#1394). The last step of the provider wizard.
 *
 * The provider is already saved. The test sends no credential: the daemon
 * reads the saved credential and sends one GET of the model list through the
 * route of the provider on the model gateway.
 *
 * The route does not exist at once. The tenant operator makes it about 30
 * seconds after the save. The panel polls the model list until the answer is
 * not "route not ready", shows the wait, and stops after a fixed time. Then
 * it runs the test. A failed test leaves the saved provider, with a button to
 * test again and a button to remove it. The Edit credentials button of the
 * provider card changes it.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, Loader2, Plug, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDeleteProvider } from "@/src/hooks/useProviderMutations";
import { apiFetch } from "@/src/lib/api/fetch";
import { waitForRoute } from "@/src/lib/providers/route-wait";

/** How often the panel asks, and how long it waits for the route. */
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 120_000;

interface TestedModel {
  name: string;
  contextWindow: number;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  models: TestedModel[];
}

type PanelState =
  | { kind: "waiting"; elapsedMs: number }
  | { kind: "testing" }
  | { kind: "passed"; result: TestResult }
  | { kind: "failed"; message: string }
  | { kind: "timeout" };

interface PollBody {
  result?: { ok: boolean; errorClass?: string };
  error?: { message?: string } | string;
}

function errorText(body: { error?: { message?: string } | string }, status: number): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message ?? `The request failed (HTTP ${status})`;
}

export function ProviderTestPanel({
  name,
  onDone,
  onRemoved,
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
}: {
  /** The name of the saved provider. */
  name: string;
  /** The person leaves the panel. The provider stays saved. */
  onDone: () => void;
  /** The person removed the provider. */
  onRemoved: () => void;
  intervalMs?: number;
  timeoutMs?: number;
}) {
  const [state, setState] = React.useState<PanelState>({ kind: "waiting", elapsedMs: 0 });
  const [runId, setRunId] = React.useState(0);
  const deleteMutation = useDeleteProvider();

  React.useEffect(() => {
    const ctl = new AbortController();
    let live = true;
    const set = (s: PanelState) => {
      if (live) setState(s);
    };
    void (async () => {
      const waited = await waitForRoute<{ ok: boolean; message: string }>({
        intervalMs,
        timeoutMs,
        signal: ctl.signal,
        onWaiting: ({ elapsedMs }) => set({ kind: "waiting", elapsedMs }),
        poll: async () => {
          const res = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}/models`, {
            signal: ctl.signal,
          });
          const body = (await res.json().catch(() => ({}))) as PollBody;
          if (!res.ok) {
            return { routeNotReady: false, result: { ok: false, message: errorText(body, res.status) } };
          }
          return {
            routeNotReady: body.result?.errorClass === "route_not_ready",
            result: { ok: true, message: "" },
          };
        },
      });
      if (!live || waited.state === "aborted") return;
      if (waited.state === "timeout") return set({ kind: "timeout" });
      if (waited.state === "error") {
        return set({ kind: "failed", message: "The provider could not be reached." });
      }
      if (!waited.result.ok) return set({ kind: "failed", message: waited.result.message });

      set({ kind: "testing" });
      try {
        // The test sends the name of the saved provider and nothing else.
        const res = await apiFetch("/api/settings/providers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
          signal: ctl.signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          result?: TestResult;
          error?: { message?: string } | string;
        };
        if (!res.ok || !body.result) {
          return set({ kind: "failed", message: errorText(body, res.status) });
        }
        if (body.result.ok) return set({ kind: "passed", result: body.result });
        set({ kind: "failed", message: body.result.error || "The connection test failed." });
      } catch {
        set({ kind: "failed", message: "The provider could not be reached." });
      }
    })();
    return () => {
      live = false;
      ctl.abort();
    };
  }, [name, runId, intervalMs, timeoutMs]);

  function testAgain() {
    setState({ kind: "waiting", elapsedMs: 0 });
    setRunId((n) => n + 1);
  }

  function remove() {
    deleteMutation.mutate(name, {
      onSuccess: () => {
        toast.success(`${name} removed`);
        onRemoved();
      },
      onError: (err) => toast.error(`Failed to remove ${name}`, { description: err.message }),
    });
  }

  const busy = state.kind === "waiting" || state.kind === "testing";

  return (
    <div className="space-y-3" data-testid="provider-test-panel">
      <Alert>
        <CheckCircle2 className="size-4 text-highlight" />
        <AlertDescription className="text-xs">
          {name} is saved. The test below uses the saved credential.
        </AlertDescription>
      </Alert>

      {state.kind === "waiting" && (
        <Alert data-testid="route-waiting">
          <Loader2 className="size-4 animate-spin" />
          <AlertDescription className="text-xs">
            Waiting for the route of the provider ({Math.round(state.elapsedMs / 1000)} s). The
            route is ready about a minute after the save.
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "testing" && (
        <Alert data-testid="test-running">
          <Loader2 className="size-4 animate-spin" />
          <AlertDescription className="text-xs">
            Testing the connection. Right after a save, the test can take up to a minute while the
            route of the provider starts.
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "timeout" && (
        <Alert data-testid="route-timeout">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">
            The route is not ready yet. The provider stays saved. Test again in a minute.
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "failed" && (
        <Alert variant="destructive" data-testid="test-failed">
          <WifiOff className="size-4" />
          <AlertDescription className="text-xs">
            The connection test failed. The provider stays saved. Edit its credentials in the list,
            or remove it.
            <span className="mt-1 block font-mono">{state.message}</span>
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "passed" && (
        <Alert className="border-highlight" data-testid="test-passed">
          <CheckCircle2 className="size-4 text-highlight" />
          <AlertDescription className="text-xs">
            Connection test passed ({state.result.latencyMs} ms).{" "}
            {state.result.models.length > 0
              ? `Found ${state.result.models.length} model${state.result.models.length === 1 ? "" : "s"}.`
              : "The provider listed no models."}
            {state.result.models.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto font-mono">
                {state.result.models.map((m) => (
                  <li key={m.name}>
                    {m.name}
                    {m.contextWindow > 0 ? ` (${m.contextWindow.toLocaleString()} ctx)` : ""}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="text-xs" disabled={busy} onClick={testAgain}>
          <Plug className="size-3" />
          Test again
        </Button>
        <Button type="button" size="sm" className="text-xs" onClick={onDone}>
          Done
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive text-xs"
          disabled={deleteMutation.isPending}
          onClick={remove}
        >
          {deleteMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          Remove provider
        </Button>
      </div>
    </div>
  );
}
