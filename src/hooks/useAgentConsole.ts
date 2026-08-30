import * as React from 'react';
import type { MissionTerminalHandle } from '@/src/components/missions/MissionTerminal';
import {
  AgentStreamRegistry,
  type AgentConsoleStatus,
} from '@/src/lib/agent-console/stream';

export type { AgentConsolePhase } from '@/src/lib/agent-console/stream';

/**
 * The registry that hands out one stream per run. The wall provides its own,
 * so a tile and its pop-out share one EventSource (dashboard#1147). Without a
 * provider, a module-level registry serves the same purpose.
 */
export const AgentStreamRegistryContext = React.createContext<AgentStreamRegistry>(
  new AgentStreamRegistry(),
);

/**
 * Attaches a terminal to a run's live stream and returns the run's status.
 *
 * The terminal first receives what the stream already buffered, then every
 * live line. The stream stays open while any surface holds it.
 */
export function useAgentConsole(
  runId: string | undefined,
  terminalRef: React.RefObject<MissionTerminalHandle | null>,
): AgentConsoleStatus {
  const registry = React.useContext(AgentStreamRegistryContext);
  const [status, setStatus] = React.useState<AgentConsoleStatus>({
    phase: 'streaming',
    summary: {},
  });

  React.useEffect(() => {
    if (!runId) return;
    const stream = registry.acquire(runId);
    const unwatch = stream.watch(setStatus);
    const unsubscribe = stream.subscribe({
      write: (text) => terminalRef.current?.write(text),
    });
    return () => {
      unsubscribe();
      unwatch();
      registry.release(runId);
    };
  }, [runId, terminalRef, registry]);

  return status;
}
