import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Typewriter } from '@/components/gibson/landing/Typewriter';
import type { TypewriterMessage } from '@/components/gibson/landing/Typewriter';

const sampleMessages: TypewriterMessage[] = [
  { label: 'CTOs', text: 'Still waiting 12 months for your agent strategy?' },
  { label: 'Platform Engineers', text: 'Tired of gluing together memory and orchestration?' },
  { label: 'DevSecOps', text: 'Running security tools manually while attackers automate?' },
];

// Default matchMedia mock — reduced motion OFF
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('Typewriter', () => {
  it('renders with aria-live polite region', () => {
    render(<Typewriter messages={sampleMessages} />);

    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
  });

  it('renders cursor with aria-hidden', () => {
    render(<Typewriter messages={sampleMessages} />);

    // The cursor "|" character is inside a span with aria-hidden="true"
    const cursorSpans = document
      .querySelectorAll('[aria-hidden="true"]');

    // At least one aria-hidden element should contain the blinking cursor
    const cursorEl = Array.from(cursorSpans).find(
      (el) => el.textContent === '|'
    );
    expect(cursorEl).toBeDefined();
    expect(cursorEl).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders all messages statically when reduced motion is preferred', () => {
    // Override matchMedia to report prefers-reduced-motion: reduce
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<Typewriter messages={sampleMessages} />);

    // All three labels must appear in the document
    expect(screen.getByText('CTOs')).toBeInTheDocument();
    expect(screen.getByText('Platform Engineers')).toBeInTheDocument();
    expect(screen.getByText('DevSecOps')).toBeInTheDocument();

    // All three message texts must appear in the document
    expect(
      screen.getByText('Still waiting 12 months for your agent strategy?')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tired of gluing together memory and orchestration?')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Running security tools manually while attackers automate?')
    ).toBeInTheDocument();
  });

  it('renders Badge element for label', () => {
    render(<Typewriter messages={sampleMessages} />);

    // In animated mode the first message label is shown in a Badge.
    // The Badge renders as an inline element containing the label text.
    expect(screen.getByText('CTOs')).toBeInTheDocument();
  });

  it('accepts custom className prop', () => {
    const { container } = render(
      <Typewriter messages={sampleMessages} className="test-class" />
    );

    // The root element of the component should carry the custom class
    expect(container.firstChild).toHaveClass('test-class');
  });
});
