/**
 * Public pricing page — three plan cards driven entirely by plans.yaml
 * (via gen-plans + pricing-display). Spec
 * plans-and-quotas-simplification R9.A.
 */

import Link from "next/link";

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
    "Three plans for Gibson: Team, Enterprise, and Enterprise (Deploy) for on-prem / whitelabel / public-sector deployments.",
};

function ctaForTier(t: PricingTierDisplay): { label: string; href: string; variant: "default" | "outline" | "secondary" } {
  if (t.contactSales) {
    return { label: "Contact sales", href: "/contact-sales?tier=" + encodeURIComponent(t.id), variant: "secondary" };
  }
  return {
    label: "Start trial",
    href: "/signup?tier=" + encodeURIComponent(t.id),
    variant: t.id === "enterprise" ? "default" : "outline",
  };
}

function Tier({ t }: { t: PricingTierDisplay }) {
  const cta = ctaForTier(t);
  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle className="text-2xl">{t.name}</CardTitle>
        <CardDescription>{t.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div>
          <div className="text-3xl font-semibold">{t.priceLabel}</div>
          {t.priceSubLabel ? (
            <div className="text-sm text-muted-foreground mt-1">{t.priceSubLabel}</div>
          ) : null}
          {t.annualSavings ? (
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

export default function PricingPage() {
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
        {pricingDisplays.map((t) => (
          <Tier key={t.id} t={t} />
        ))}
      </div>
      <p className="mt-12 text-center text-sm text-muted-foreground">
        Looking for an air-gapped or compliance-led deployment? See{" "}
        <Link href="/contact-sales?tier=enterprise-deploy" className="underline">
          Enterprise (Deploy)
        </Link>
        .
      </p>
    </main>
  );
}
