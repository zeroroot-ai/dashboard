import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeaturesSection } from '@/components/gibson/landing/FeaturesSection';
import { TrustSignals } from '@/components/gibson/landing/TrustSignals';
import { ClosingCTA } from '@/components/gibson/landing/ClosingCTA';
import { HeroSection } from '@/components/gibson/landing/HeroSection';

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

describe('FeaturesSection', () => {
  it('renders all 6 feature titles', () => {
    render(<FeaturesSection />);

    expect(screen.getByText('Mission Orchestration')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('Persistent Memory')).toBeInTheDocument();
    expect(screen.getByText('Bring Your Own LLM')).toBeInTheDocument();
    expect(screen.getByText('Security Tools Built In')).toBeInTheDocument();
    expect(screen.getByText('Full Observability')).toBeInTheDocument();
  });

  it('renders section heading', () => {
    render(<FeaturesSection />);

    // &apos; in JSX renders as a plain apostrophe in the DOM
    expect(
      screen.getByText("What You Don't Have to Build")
    ).toBeInTheDocument();
  });
});

describe('TrustSignals', () => {
  it('renders all trust badges', () => {
    render(<TrustSignals />);

    expect(screen.getByText('Designed for Kubernetes')).toBeInTheDocument();
    expect(screen.getByText('SOC2 Ready')).toBeInTheDocument();
    expect(screen.getByText('Open Source Core')).toBeInTheDocument();
  });
});

describe('ClosingCTA', () => {
  it('renders headline and buttons', () => {
    render(<ClosingCTA />);

    // Partial match on the heading text
    expect(
      screen.getByText(/Stop Building Agent Infrastructure/i)
    ).toBeInTheDocument();

    // "Get Started Free" is a Next.js Link rendered as an anchor
    expect(
      screen.getByRole('link', { name: /Get Started Free/i })
    ).toBeInTheDocument();

    // "Book a Demo" is an external anchor
    expect(
      screen.getByRole('link', { name: /Book a Demo/i })
    ).toBeInTheDocument();
  });
});

describe('HeroSection', () => {
  it('renders static content', () => {
    render(<HeroSection />);

    expect(
      screen.getByText('Production Agent Infrastructure. Already Built.')
    ).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: /Get Started Free/i })
    ).toBeInTheDocument();
  });
});
