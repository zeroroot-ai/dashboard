/**
 * Public pricing page — three top cards driven by plans.yaml (via
 * gen-plans + pricing-display) plus a full-width bottom card for the
 * on-prem / air-gapped / federal deployment option.
 *
 * Spec plans-and-quotas-simplification R9.A.
 *
 * Spec stripe-billing-integration Task 16 / R7.3 overlays the live
 * Stripe price (fetched server-side via `fetchStripePrices`, cached
 * for 60s) onto the displayed monthly figure for SaaS tiers. When
 * Stripe is unreachable each SaaS card renders a "pricing temporarily
 * unavailable" placeholder rather than the plans.yaml fallback (R7.3:
 * Stripe is the source of truth at render time; placeholder beats
 * stale). Contact-sales tiers (enterprise-deploy) never fetch prices.
 */

import Link from "next/link";

import { fetchStripePrices } from "@/src/lib/billing/fetch-prices";
import type { BillingTier } from "@/src/lib/billing/stripe_gen";
import { pricingDisplays, type PricingTierDisplay } from "@/src/lib/pricing-display";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Pricing — Gibson",
  description:
    "Three Gibson plans for SaaS — Team, Org, and Enterprise — plus a self-hosted option for on-prem, air-gapped, and federal deployments.",
};

const SAAS_TIER_IDS = new Set(["team", "org", "enterprise"]);
const FEATURED_TIER_ID = "org";
const DEPLOY_TIER_ID = "enterprise-deploy";

const PLACEHOLDER_PRICE = "Pricing temporarily unavailable";
const PLACEHOLDER_SUB = "Try again in a minute, or contact sales for a quote.";

function ctaForTier(t: PricingTierDisplay): {
  label: string;
  href: string;
  variant: "default" | "outline";
} {
  return {
    label: "Start trial",
    href: "/signup?plan=" + encodeURIComponent(t.id),
    variant: t.id === FEATURED_TIER_ID ? "default" : "outline",
  };
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Resolve the price-card shape for one SaaS tier, given the live Stripe map. */
function resolvePriceCard(
  t: PricingTierDisplay,
  livePrice: number | null | undefined,
): { priceLabel: string; priceSubLabel: string | null; degraded: boolean } {
  // Live Stripe price wins when present.
  if (typeof livePrice === "number") {
    return {
      priceLabel: `${dollars(livePrice)}/mo`,
      priceSubLabel: t.priceSubLabel,
      degraded: false,
    };
  }
  // Stripe unreachable → R7.3 placeholder (NOT the plans.yaml fallback).
  return {
    priceLabel: PLACEHOLDER_PRICE,
    priceSubLabel: PLACEHOLDER_SUB,
    degraded: true,
  };
}

function Tier({
  t,
  featured,
  livePrice,
}: {
  t: PricingTierDisplay;
  featured: boolean;
  livePrice: number | null | undefined;
}) {
  const cta = ctaForTier(t);
  const card = resolvePriceCard(t, livePrice);
  return (
    <Card
      className={
        "flex flex-col h-full " +
        (featured ? "border-primary shadow-md ring-1 ring-primary/30" : "")
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-2xl">{t.name}</CardTitle>
          {featured ? (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-primary text-primary-foreground">
              Most popular
            </span>
          ) : null}
        </div>
        <CardDescription>{t.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div>
          <div
            className={
              card.degraded
                ? "text-lg font-medium text-muted-foreground"
                : "text-3xl font-semibold"
            }
          >
            {card.priceLabel}
          </div>
          {card.priceSubLabel ? (
            <div className="text-sm text-muted-foreground mt-1">{card.priceSubLabel}</div>
          ) : null}
          {!card.degraded && t.annualSavings ? (
            <div className="inline-block mt-2 text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">
              {t.annualSavings}
            </div>
          ) : null}
        </div>
        <ul className="space-y-2 text-sm">
          <li>
            <span className="font-medium">{t.concurrentMissionsLabel}</span>
            <div className="text-muted-foreground">in non-terminal execution at any moment</div>
          </li>
          <li>
            <span className="font-medium">{t.concurrentAgentsLabel}</span>
            <div className="text-muted-foreground">bound to in-flight tasks at any moment</div>
          </li>
        </ul>
      </CardContent>
      <CardFooter>
        <Button asChild variant={cta.variant} className="w-full">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

const onPremFeatures: { title: string; body: string }[] = [
  {
    title: "Self-hosted in your VPC, datacentre, or air-gapped enclave",
    body: "Helm chart deploys the full Gibson stack into your Kubernetes cluster. No egress, no telemetry, no callbacks home.",
  },
  {
    title: "Bring your own models",
    body: "Run against your own LLM endpoints, vLLM clusters, or vendor inference deployments. Prompts and results never leave your boundary.",
  },
  {
    title: "Bring your own secrets backend",
    body: "Integrate with HashiCorp Vault, AWS KMS, or your existing PKI. Per-tenant KEK derivation and SPIFFE workload identity built in.",
  },
  {
    title: "SSO and SCIM",
    body: "OIDC and SAML to your IdP (Okta, Entra, PingFederate, Keycloak). SCIM 2.0 user lifecycle. Per-tenant role mapping.",
  },
  {
    title: "Audit log streaming",
    body: "Export every authentication, authorisation, and orchestration event to your SIEM via syslog, Kafka, or OpenTelemetry.",
  },
  {
    title: "Capable of GovCloud, IL5 / IL6, and FIPS 140-3 environments",
    body: "Ships against FIPS-validated cryptographic modules. Compatible with AWS GovCloud (US), Azure Government, and on-prem environments accredited to IL5 / IL6. Customer holds the ATO; we provide the artefacts.",
  },
  {
    title: "Custom retention and data residency",
    body: "Pick where mission data, embeddings, and graph state live. Configurable retention windows per data class.",
  },
  {
    title: "Dedicated support with named engineers",
    body: "Direct Slack or Teams channel with the engineers who build Gibson. Defined response times, scheduled office hours, custom SLAs.",
  },
];

function OnPremCard({ t }: { t: PricingTierDisplay }) {
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-2xl">{t.name}</CardTitle>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
            Self-hosted
          </span>
        </div>
        <CardDescription className="text-base">{t.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {onPremFeatures.map((f) => (
            <div key={f.title}>
              <div className="font-medium text-sm">{f.title}</div>
              <div className="text-sm text-muted-foreground mt-1">{f.body}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button asChild>
            <Link href={"/contact-sales?tier=" + encodeURIComponent(t.id)}>
              Talk to the team
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            Quotas, pricing, and rollout shape are set per engagement.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function PricingPage() {
  const saasTiers = pricingDisplays.filter((t) => SAAS_TIER_IDS.has(t.id));
  const deployTier = pricingDisplays.find((t) => t.id === DEPLOY_TIER_ID);

  // Server-side fetch (60s unstable_cache). On Stripe outage every
  // SaaS tier resolves to null and the page renders placeholders, never 500s.
  const livePrices = await fetchStripePrices();

  return (
    <main className="container mx-auto py-12 px-4 max-w-6xl">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold">Pricing</h1>
        <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">
          Two enforced quotas: concurrent missions in flight, and agents currently bound to a
          mission task. Idle agents do not count.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {saasTiers.map((t) => (
          <Tier
            key={t.id}
            t={t}
            featured={t.id === FEATURED_TIER_ID}
            livePrice={livePrices[t.id as BillingTier]}
          />
        ))}
      </div>

      {deployTier ? (
        <div className="mt-10">
          <OnPremCard t={deployTier} />
        </div>
      ) : null}
    </main>
  );
}
