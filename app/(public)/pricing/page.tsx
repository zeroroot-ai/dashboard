"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Server, Shield, Github } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  pricingDisplays,
  type PricingTierDisplay,
} from "@/src/lib/pricing-display";

// Alias to minimize churn in local JSX — the display struct is the same
// shape the legacy PricingTier type carried.
type PricingTier = PricingTierDisplay;
const pricingTiers = pricingDisplays;

type BillingCycle = "monthly" | "annual";

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

function PriceDisplay({
  tier,
  billing,
}: {
  tier: PricingTier;
  billing: BillingCycle;
}) {
  if (tier.contactOnly) {
    return (
      <div>
        <span className="font-mono text-4xl font-bold">Custom</span>
        <p className="text-sm text-muted-foreground mt-1">Contact sales</p>
      </div>
    );
  }

  // Enterprise Cloud: annual-only
  if (tier.monthlyPrice === null && tier.annualPrice !== null) {
    return (
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-4xl font-bold">
            {formatMoney(tier.annualPrice)}
          </span>
          <span className="text-sm text-muted-foreground">/yr</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Annual only</p>
      </div>
    );
  }

  if (tier.monthlyPrice === null) {
    return (
      <div>
        <span className="font-mono text-4xl font-bold">Custom</span>
      </div>
    );
  }

  const effectiveMonthly =
    billing === "annual" && tier.annualPrice
      ? Math.round(tier.annualPrice / 12)
      : tier.monthlyPrice;

  const showStrikethrough =
    billing === "annual" &&
    tier.annualPrice !== null &&
    (tier.annualSavingsPct ?? 0) > 0;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-4xl font-bold">
          {formatMoney(effectiveMonthly)}
        </span>
        <span className="text-sm text-muted-foreground">/mo</span>
        {showStrikethrough && (
          <span className="text-sm text-muted-foreground line-through">
            {formatMoney(tier.monthlyPrice)}/mo
          </span>
        )}
      </div>
      {billing === "annual" && tier.annualPrice && (
        <p className="text-sm text-muted-foreground mt-1">
          Billed {formatMoney(tier.annualPrice)}/yr
        </p>
      )}
      {typeof tier.includedSeats === "number" && tier.perSeatBase && (
        <p className="text-xs text-muted-foreground mt-1">
          {formatMoney(tier.perSeatBase)}/seat base ·{" "}
          {tier.perSeatOverage ? `${formatMoney(tier.perSeatOverage)}/overage` : ""}
        </p>
      )}
    </div>
  );
}

function TierCard({
  tier,
  billing,
}: {
  tier: PricingTier;
  billing: BillingCycle;
}) {
  const highlight = tier.isMostPopular;

  const cardFeatureLines = [
    `${tier.includedSeats === "Unlimited" ? "Unlimited" : `${tier.includedSeats}`} ${tier.includedSeats === 1 ? "seat" : "seats included"}`,
    `${tier.concurrentAgents} concurrent agents`,
    `${tier.graphStorage} graph storage`,
    `${tier.retention} retention`,
    `${tier.sandboxLaunchesPerMonth} sandbox launches/mo`,
    tier.sso === true ? "SSO / OIDC" : null,
    tier.auditLogs === true ? "Audit logs" : null,
    tier.complianceExports === true ? "Compliance exports (SOC2, HIPAA)" : null,
    tier.dedicatedSlack === true
      ? "Dedicated Slack"
      : tier.dedicatedSlack === "priority"
        ? "Priority Slack"
        : null,
    tier.dedicatedTenant === true ? "Dedicated tenant" : null,
    tier.deployment,
    tier.responseSla,
    ...tier.additionalNotes,
  ].filter((s): s is string => Boolean(s));

  return (
    <Card
      className={
        highlight
          ? "ring-2 ring-green-500 relative flex flex-col"
          : "relative flex flex-col"
      }
    >
      {highlight && (
        <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-0">
          <Badge className="bg-green-500 text-white hover:bg-green-600">
            Most Popular
          </Badge>
        </div>
      )}
      <CardHeader className={highlight ? "pt-6" : undefined}>
        <CardTitle className="text-xl font-bold">{tier.name}</CardTitle>
        <PriceDisplay tier={tier} billing={billing} />
        <p className="text-sm text-muted-foreground mt-2">{tier.tagline}</p>
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        <Separator />
        <ul className="space-y-3 mt-6 flex-1">
          {cardFeatureLines.map((feature) => (
            <li
              key={feature}
              className="flex flex-row items-start gap-2"
            >
              <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <Button variant={tier.cta.variant} className="w-full" asChild>
            <Link href={tier.cta.href}>{tier.cta.label}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Page ----------------------------------------------------------------

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingCycle>("annual");

  return (
    <div className="bg-background text-foreground">
      {/* Hero */}
      <section className="text-center py-16 px-4">
        <h1 className="text-4xl font-bold">Simple, transparent pricing</h1>
        <p className="text-lg text-muted-foreground mt-4 max-w-2xl mx-auto">
          Build unlimited agents, tools, plugins, and missions at every paid
          tier. You&apos;re charged for parallelism, people, storage, and
          detonation — not for what you build.
        </p>
      </section>

      {/* Billing toggle */}
      <div className="flex justify-center">
        <div className="flex flex-row items-center gap-3">
          <span
            className={
              billing === "monthly"
                ? "text-sm font-medium"
                : "text-sm text-muted-foreground"
            }
          >
            Monthly
          </span>
          <Switch
            checked={billing === "annual"}
            onCheckedChange={(checked) =>
              setBilling(checked ? "annual" : "monthly")
            }
            aria-label="Toggle annual billing"
          />
          <span
            className={
              billing === "annual"
                ? "text-sm font-medium"
                : "text-sm text-muted-foreground"
            }
          >
            Annual
          </span>
          {billing === "annual" && (
            <Badge variant="secondary">Save 5%</Badge>
          )}
        </div>
      </div>

      {/* Self-serve tier cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto px-4 py-12">
        {pricingTiers
          .filter((t) => !t.contactOnly && t.id !== "enterprise-cloud")
          .map((tier) => (
            <TierCard key={tier.id} tier={tier} billing={billing} />
          ))}
      </section>

      {/* Enterprise tier cards */}
      <section className="max-w-7xl mx-auto px-4 pb-4">
        <h2 className="text-2xl font-bold text-center mb-2">Enterprise</h2>
        <p className="text-center text-sm text-muted-foreground mb-8 max-w-2xl mx-auto">
          Dedicated infrastructure, on-prem Kubernetes, or government
          deployments via cleared partners. Unlimited seats, storage, and
          retention.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pricingTiers
            .filter((t) =>
              ["enterprise-cloud", "enterprise-onprem", "public-sector"].includes(t.id),
            )
            .map((tier) => (
              <TierCard key={tier.id} tier={tier} billing={billing} />
            ))}
        </div>
      </section>

      {/* Footnotes */}
      <section className="max-w-4xl mx-auto px-4 py-8">
        <dl className="space-y-4 text-sm text-muted-foreground">
          <div>
            <dt className="font-semibold text-foreground inline">
              Concurrent agents —{" "}
            </dt>
            <dd className="inline">
              the number of agents that can be running simultaneously. Agents
              can be built and stored in unlimited quantities.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground inline">
              Sandbox launches —{" "}
            </dt>
            <dd className="inline">
              every time Gibson runs untrusted code — an LLM-generated
              exploit, an unknown binary, a third-party tool — it asks{" "}
              <strong>Setec</strong> to boot a fresh Firecracker microVM,
              run the code in hardware isolation, stream the output back,
              and tear the VM down. One tool invocation = one launch. Tiers
              set your monthly quota; overage pricing is per-launch and
              negotiated at the tier level — contact us for current rates.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground inline">
              Graph retention —{" "}
            </dt>
            <dd className="inline">
              how long Gibson&apos;s knowledge graph retains mission data
              before archival.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground inline">BYOK — </dt>
            <dd className="inline">
              all tiers require you to bring your own LLM API keys
              (Anthropic, OpenAI, Gemini, or local Ollama).
            </dd>
          </div>
        </dl>
      </section>

      {/* Trust line */}
      <section className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-base font-medium">
          Everything built on the platform — agents, tools, plugins, mission
          definitions, mission runs — is unlimited at every paid tier. We
          charge for parallelism, people, storage, and detonation.
        </p>
      </section>

      {/* Trust signals */}
      <section className="flex justify-center gap-12 py-16 text-muted-foreground px-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">
            Designed For Security Teams
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">SOC2 Ready</span>
        </div>
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">Open Source Core</span>
        </div>
      </section>
    </div>
  );
}
