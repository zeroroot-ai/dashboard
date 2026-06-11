import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroSection } from '@/components/gibson/landing/HeroSection';
import { WhatYouGet } from '@/components/gibson/landing/WhatYouGet';
import { WhatYouRunItOn } from '@/components/gibson/landing/WhatYouRunItOn';

// matchMedia mock required by HeroSection → Typewriter
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

describe('HeroSection', () => {
  it('renders the terminal commands', () => {
    render(<HeroSection />);

    expect(
      screen.getByText(/git clone https:\/\/github\.com\/zeroroot-ai\/adk/),
    ).toBeInTheDocument();
    expect(screen.getByText('gibson login')).toBeInTheDocument();
    expect(
      screen.getByText('gibson component init recon-agent --kind agent'),
    ).toBeInTheDocument();
    expect(screen.getByText('gibson mission submit recon.cue')).toBeInTheDocument();
  });

  it('renders primary and secondary CTAs', () => {
    render(<HeroSection />);

    expect(
      screen.getByRole('link', { name: /Start Free/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Star the ADK/i }),
    ).toBeInTheDocument();
  });
});

describe('WhatYouGet', () => {
  it('renders all six terms', () => {
    render(<WhatYouGet />);

    for (const term of [
      'ADK',
      'gibson CLI',
      'DAG missions',
      'Knowledge graph',
      'RBAC',
      'Observability',
    ]) {
      expect(screen.getByText(term)).toBeInTheDocument();
    }
  });
});

describe('WhatYouRunItOn', () => {
  it('calls out the SaaS endpoint and Setec sandbox', () => {
    render(<WhatYouRunItOn />);

    expect(screen.getByText('api.zeroroot.ai')).toBeInTheDocument();
    expect(screen.getByText(/Setec microVMs/)).toBeInTheDocument();
  });
});
