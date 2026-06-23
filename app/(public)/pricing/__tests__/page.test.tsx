/**
 * Pricing page, Start-trial link contract.
 *
 * The public /pricing page is the entry point for self-serve signup. Each
 * SaaS tier card has a "Start trial" CTA. The contract with the rest of
 * the dashboard is that this CTA points at `/signup?plan=<id>`, which is
 * the param name `app/(public)/signup/page.tsx` validates against
 * `selfServeTierIds`. The signup page redirects back to
 * `/pricing?missing_plan=true` whenever the plan param is missing or
 * unknown, so getting the param name wrong here turns Start-trial into a
 * silent redirect loop. (This test was added after exactly that bug.)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/src/lib/billing/fetch-prices', () => ({
  fetchStripePrices: vi.fn(async () => ({ team: null, org: null, enterprise: null })),
}));

import PricingPage from '../page';

afterEach(() => {
  vi.unstubAllEnvs();
});

// The "Start trial" → /signup?plan=<id> self-serve contract only applies when
// paid billing is enabled (hosted). On-prem/default (dashboard#842 flag-gate)
// the SaaS CTA becomes "Contact sales" instead. Both are asserted below.
describe('PricingPage Start-trial CTAs (billing enabled)', () => {
  it.each(['team', 'org', 'enterprise'] as const)('routes the %s tier CTA to /signup with that plan', async (tierId) => {
    vi.stubEnv('DASHBOARD_BILLING_PAID_TIERS_ENABLED', 'true');
    const ui = await PricingPage();
    const { container } = render(ui);

    const startTrialLinks = Array.from(
      container.querySelectorAll('a'),
    ).filter((a) => a.textContent?.trim() === 'Start trial');

    const hrefs = startTrialLinks.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/signup?plan=${tierId}`);
  });
});

describe('PricingPage CTA when billing is disabled (on-prem default)', () => {
  it('renders "Contact sales" and no /signup?plan trial links', async () => {
    vi.stubEnv('DASHBOARD_BILLING_PAID_TIERS_ENABLED', '');
    const ui = await PricingPage();
    const { container } = render(ui);

    const anchors = Array.from(container.querySelectorAll('a'));
    const labels = anchors.map((a) => a.textContent?.trim());
    const hrefs = anchors.map((a) => a.getAttribute('href') ?? '');

    expect(labels).toContain('Contact sales');
    expect(labels).not.toContain('Start trial');
    expect(hrefs.some((h) => h.startsWith('/signup?plan='))).toBe(false);
  });
});
