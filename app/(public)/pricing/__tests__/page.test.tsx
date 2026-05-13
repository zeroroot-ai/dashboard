/**
 * Pricing page — Start-trial link contract.
 *
 * The public /pricing page is the entry point for self-serve signup. Each
 * SaaS tier card has a "Start trial" CTA. The contract with the rest of
 * the dashboard is that this CTA points at `/signup?plan=<id>`, which is
 * the param name `app/(public)/signup/page.tsx` validates against
 * `selfServeTierIds`. The signup page redirects back to
 * `/pricing?missing_plan=true` whenever the plan param is missing or
 * unknown — so getting the param name wrong here turns Start-trial into a
 * silent redirect loop. (This test was added after exactly that bug.)
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/src/lib/billing/fetch-prices', () => ({
  fetchStripePrices: vi.fn(async () => ({ team: null, org: null, enterprise: null })),
}));

import PricingPage from '../page';

describe('PricingPage Start-trial CTAs', () => {
  it.each(['team', 'org', 'enterprise'] as const)('routes the %s tier CTA to /signup with that plan', async (tierId) => {
    const ui = await PricingPage();
    const { container } = render(ui);

    const startTrialLinks = Array.from(
      container.querySelectorAll('a'),
    ).filter((a) => a.textContent?.trim() === 'Start trial');

    const hrefs = startTrialLinks.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/signup?plan=${tierId}`);
  });
});
