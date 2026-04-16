export interface Plan {
  id: 'indie' | 'team' | 'business' | 'enterprise';
  name: string;
  description: string;
  monthlyPrice: number | null;  // null = contact sales
  annualPrice: number | null;
  tier: string;
  features: string[];
  seats: number | string;
  cta: { label: string; variant: 'default' | 'outline' | 'secondary' };
  badge?: string;
}

export const plans: Plan[] = [
  {
    id: 'indie',
    name: 'Indie',
    description: 'For bug bounty hunters and independent security researchers',
    monthlyPrice: 99,
    annualPrice: 950,
    tier: 'indie',
    cta: { label: 'Start Free Trial', variant: 'outline' },
    seats: 1,
    features: [
      '1 seat',
      'Unlimited agents',
      'All security tools',
      'Unlimited missions',
      'Unlimited GraphRAG',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For small security teams scaling their operations',
    monthlyPrice: 745,
    annualPrice: 7152,
    tier: 'team',
    badge: 'Most Popular',
    cta: { label: 'Start Free Trial', variant: 'default' },
    seats: 5,
    features: [
      'Up to 5 seats',
      'Unlimited agents',
      'All security tools',
      'Unlimited missions',
      'Unlimited GraphRAG',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    description: 'For security organizations operating at scale',
    monthlyPrice: 2780,
    annualPrice: 26690,
    tier: 'business',
    cta: { label: 'Start Free Trial', variant: 'default' },
    seats: 20,
    features: [
      'Up to 20 seats',
      'Unlimited agents',
      'All security tools',
      'Unlimited missions',
      'Unlimited GraphRAG',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Self-hosted deployment with dedicated engineering support',
    monthlyPrice: null,
    annualPrice: null,
    tier: 'enterprise',
    cta: { label: 'Contact Sales', variant: 'secondary' },
    seats: 'Unlimited',
    features: [
      'Unlimited seats',
      'Self-hosted (your Kubernetes cluster)',
      'SSO / OIDC',
      'Custom roles',
      'Compliance export (SOC2, HIPAA)',
      'Forward deployed engineer',
      '365-day audit retention',
    ],
  },
];
