'use client';

/**
 * The subscription sign-in relay for one bank member (gibson#1706 lane E2,
 * epic decision 8).
 *
 * start() asks the daemon to run the Anthropic sign-in inside the member's
 * sandbox and subscribes to its steps: the URL to open, then the code
 * prompt, then done or error. submitCode() passes the code back. Nothing
 * from the stream is written to browser storage, and nothing is sent to
 * analytics: the state lives in this hook for the life of the panel.
 */

import * as React from 'react';
import { apiFetch } from '@/src/lib/api/fetch';
import type { SignInStepView } from '@/src/lib/banks/view';

type SignInPhase = 'idle' | 'starting' | 'waiting_url' | 'open_url' | 'code' | 'submitting' | 'done' | 'error';

interface SignInRelay {
  phase: SignInPhase;
  url: string;
  codePrompt: string;
  error: string;
  start: () => Promise<void>;
  submitCode: (code: string) => Promise<void>;
}

/** The subset of EventSource the relay uses. Tests pass a fake. */
interface SignInEventSourceLike {
  addEventListener: (name: string, fn: (e: MessageEvent<string>) => void) => void;
  close: () => void;
}

function base(bankId: string, memberId: string): string {
  return `/api/banks/${encodeURIComponent(bankId)}/members/${encodeURIComponent(memberId)}/sign-in`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return body.error?.message ?? `${fallback} (HTTP ${res.status})`;
}

export function useSignInRelay(
  bankId: string,
  memberId: string,
  open: (url: string) => SignInEventSourceLike = (url) => new EventSource(url),
): SignInRelay {
  const [phase, setPhase] = React.useState<SignInPhase>('idle');
  const [url, setUrl] = React.useState('');
  const [codePrompt, setCodePrompt] = React.useState('');
  const [error, setError] = React.useState('');
  const esRef = React.useRef<SignInEventSourceLike | null>(null);

  React.useEffect(() => () => esRef.current?.close(), []);

  const subscribe = React.useCallback(() => {
    esRef.current?.close();
    const es = open(`${base(bankId, memberId)}/events`);
    esRef.current = es;
    es.addEventListener('step', (e) => {
      let step: SignInStepView;
      try {
        step = JSON.parse(e.data) as SignInStepView;
      } catch {
        return;
      }
      if (step.error) {
        setError(step.error);
        setPhase('error');
        es.close();
        return;
      }
      if (step.done) {
        setPhase('done');
        es.close();
        return;
      }
      if (step.url) {
        setUrl(step.url);
        setPhase('open_url');
      }
      if (step.codePrompt) {
        setCodePrompt(step.codePrompt);
        setPhase('code');
      }
    });
    es.addEventListener('notfound', () => {
      setError('The member is no longer there.');
      setPhase('error');
      es.close();
    });
    es.addEventListener('error', (e) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      setError('The sign-in stream is unavailable.');
      setPhase('error');
      es.close();
    });
  }, [bankId, memberId, open]);

  const start = React.useCallback(async () => {
    setPhase('starting');
    setError('');
    setUrl('');
    setCodePrompt('');
    const res = await apiFetch(base(bankId, memberId), { method: 'POST' });
    if (!res.ok) {
      setError(await readError(res, 'Failed to start the sign-in'));
      setPhase('error');
      return;
    }
    setPhase('waiting_url');
    subscribe();
  }, [bankId, memberId, subscribe]);

  const submitCode = React.useCallback(
    async (code: string) => {
      setPhase('submitting');
      const res = await apiFetch(`${base(bankId, memberId)}/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Failed to submit the code'));
        setPhase('error');
        return;
      }
      // The outcome arrives on the stream: done or error.
      setPhase('code');
      setCodePrompt('');
    },
    [bankId, memberId],
  );

  return { phase, url, codePrompt, error, start, submitCode };
}
