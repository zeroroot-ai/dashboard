import { render, screen } from '@testing-library/react';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { AssistantMessage, UserMessage } from '../ChatContent';

/**
 * Regression for the "The current scope does not have a 'part' property" crash
 * that made /dashboard/chat unusable from the very first assistant-ui migration
 * (#452).
 *
 * The bug: `MessagePartPrimitive.InProgress` was rendered at the MESSAGE scope
 * (a sibling of `MessagePrimitive.Parts`). That primitive reads `s.part`, which
 * only exists inside a message-PART scope, so the proxied assistant state threw
 * on every assistant-message render — before `.status` was ever consulted.
 *
 * This harness renders the real `AssistantMessage` through a minimal external
 * store runtime. Pre-fix it throws during render; post-fix it renders the text.
 */

function MessageThread({ messages }: { messages: ThreadMessageLike[] }) {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    // Identity converter so the runtime runs `fromThreadMessageLike` and builds
    // full ThreadMessages (metadata/parts/status). Without it the raw input is
    // treated as already-converted and lacks the metadata the runtime reads.
    convertMessage: (m) => m,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ AssistantMessage, UserMessage }} />
    </AssistantRuntimeProvider>
  );
}

describe('AssistantMessage part-scope wiring', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; assistant-ui primitives reference it.
    if (!('ResizeObserver' in globalThis)) {
      globalThis.ResizeObserver = class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      } as unknown as typeof ResizeObserver;
    }
  });

  it('renders a completed assistant message without throwing a part-scope error', () => {
    const messages: ThreadMessageLike[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'text', text: 'Hello from the assistant' }],
        status: { type: 'complete', reason: 'stop' },
      },
    ];

    expect(() => render(<MessageThread messages={messages} />)).not.toThrow();
    expect(screen.getByText('Hello from the assistant')).toBeInTheDocument();
  });

  it('renders a user message alongside an assistant message', () => {
    const messages: ThreadMessageLike[] = [
      { role: 'user', id: 'u1', content: [{ type: 'text', text: 'ping' }] },
      {
        role: 'assistant',
        id: 'a1',
        content: [{ type: 'text', text: 'pong' }],
        status: { type: 'complete', reason: 'stop' },
      },
    ];

    render(<MessageThread messages={messages} />);
    expect(screen.getByText('ping')).toBeInTheDocument();
    expect(screen.getByText('pong')).toBeInTheDocument();
  });
});
