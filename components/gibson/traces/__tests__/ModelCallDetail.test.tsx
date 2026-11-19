// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Contract test for ModelCallDetail, the one view of a model call.
 *
 * It asserts what the user sees: the metadata, the cache counts, the cost, the
 * error text, and each item by its item type. It also asserts that the text of
 * an item never becomes HTML.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ModelCallDetail } from '../ModelCallDetail';
import { adaptCallDetail } from '@/src/lib/world-traces';
import type { LlmCallDetailData } from '@/src/types/trace';

function detail(over: Record<string, unknown> = {}): LlmCallDetailData {
  return adaptCallDetail({
    callId: 'c1',
    runId: 'r1',
    model: 'gpt-4o',
    scopeId: 's1',
    promptTokens: 120,
    completionTokens: 40,
    requestItems: [],
    outputItems: [],
    provider: 'openai',
    httpStatus: 200,
    cacheReadTokens: 64,
    cacheWriteTokens: 16,
    cost: '0.0021',
    errorText: '',
    ...over,
  } as never);
}

describe('ModelCallDetail', () => {
  it('shows the provider, the model, the status, the tokens and the cost', () => {
    render(<ModelCallDetail call={detail()} />);
    expect(screen.getByText('openai')).toBeDefined();
    expect(screen.getByText('gpt-4o')).toBeDefined();
    expect(screen.getByTestId('model-call-status').textContent).toBe('200');
    expect(screen.getByText('120')).toBeDefined();
    expect(screen.getByText('40')).toBeDefined();
    expect(screen.getByTestId('model-call-cache-read').textContent).toBe('64');
    expect(screen.getByTestId('model-call-cache-write').textContent).toBe('16');
    expect(screen.getByTestId('model-call-cost').textContent).toBe('$0.0021');
  });

  it('shows "Unknown" for an empty cost and for an HTTP status of 0', () => {
    render(<ModelCallDetail call={detail({ cost: '', httpStatus: 0 })} />);
    expect(screen.getByTestId('model-call-cost').textContent).toBe('Unknown');
    expect(screen.getByTestId('model-call-status').textContent).toBe('Unknown');
  });

  it('shows the request items before the output items, each by its item type', () => {
    const { container } = render(
      <ModelCallDetail
        call={detail({
          requestItems: [
            '{"type":"message","role":"user","content":[{"type":"input_text","text":"scan the host"}]}',
            '{"type":"function_call_output","call_id":"t1","output":"80/tcp open"}',
          ],
          outputItems: [
            '{"type":"reasoning","summary":[{"type":"summary_text","text":"think first"}]}',
            '{"type":"function_call","call_id":"t2","name":"nmap","arguments":"{\\"host\\":\\"a\\"}"}',
            '{"type":"message","role":"assistant","content":"all done"}',
          ],
        })}
      />,
    );

    const request = screen.getByTestId('model-call-request-items');
    const output = screen.getByTestId('model-call-output-items');
    expect(
      request.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(request).getByText('User')).toBeDefined();
    expect(within(request).getByText('scan the host')).toBeDefined();
    expect(within(request).getByText('Function call output')).toBeDefined();
    expect(within(request).getByText('80/tcp open')).toBeDefined();

    expect(within(output).getByText('Reasoning')).toBeDefined();
    expect(within(output).getByText('think first')).toBeDefined();
    expect(within(output).getByText('Function call: nmap')).toBeDefined();
    expect(within(output).getByText('{"host":"a"}')).toBeDefined();
    expect(within(output).getByText('Assistant')).toBeDefined();
    expect(within(output).getByText('all done')).toBeDefined();

    expect(container.querySelectorAll('[data-testid^="model-call-item-"]')).toHaveLength(5);
  });

  it('shows an item of an unknown type as raw JSON', () => {
    render(
      <ModelCallDetail call={detail({ outputItems: ['{"type":"web_search_call","id":"w1"}'] })} />,
    );
    const item = screen.getByTestId('model-call-item-unknown');
    expect(item.textContent).toContain('Unknown item (raw JSON)');
    expect(item.textContent).toContain('"web_search_call"');
  });

  it('shows a JSON text that does not parse as raw text and still renders the page', () => {
    render(
      <ModelCallDetail
        call={detail({
          requestItems: ['{"type":"message", broken', '"<purged text>"'],
          outputItems: ['{"type":"message","role":"assistant","content":"still here"}'],
        })}
      />,
    );
    expect(screen.getByText('{"type":"message", broken')).toBeDefined();
    expect(screen.getByText('<purged text>')).toBeDefined();
    expect(screen.getByText('still here')).toBeDefined();
  });

  it('renders the text of an item as text, never as HTML or Markdown', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script> **bold**';
    const { container } = render(
      <ModelCallDetail
        call={detail({
          requestItems: [JSON.stringify({ type: 'message', role: 'user', content: hostile })],
          outputItems: [
            JSON.stringify({ type: 'message', role: 'assistant', content: hostile }),
            JSON.stringify({ type: 'function_call', name: '<b>x</b>', arguments: hostile }),
          ],
          errorText: hostile,
        })}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getAllByText(hostile).length).toBe(4);
  });

  it('shows the status and the error text of a failed model call with its request', () => {
    render(
      <ModelCallDetail
        call={detail({
          httpStatus: 404,
          promptTokens: 0,
          completionTokens: 0,
          cost: '',
          errorText: 'route not found',
          requestItems: ['{"type":"message","role":"user","content":"hi"}'],
        })}
      />,
    );
    expect(screen.getByTestId('model-call-status').textContent).toBe('404');
    expect(screen.getByTestId('model-call-error').textContent).toBe('route not found');
    expect(screen.getByText('hi')).toBeDefined();
    expect(screen.queryByTestId('model-call-output-items')).toBeNull();
  });

  it('shows the metadata only when the model call has no items', () => {
    render(<ModelCallDetail call={detail()} />);
    expect(screen.getByText('This model call has no record text.')).toBeDefined();
    expect(screen.queryByTestId('model-call-request-items')).toBeNull();
  });
});
