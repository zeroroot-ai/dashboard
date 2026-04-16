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
import { plans, type Plan } from "@/src/lib/plans";

type BillingCycle = "monthly" | "annual";

function PriceDisplay({
  plan,
  billing,
}: {
  plan: Plan;
  billing: BillingCycle;
}) {
  if (plan.monthlyPrice === null) {
    return (
      <div>
        <span className="font-mono text-4xl font-bold">Custom</span>
        <p className="text-sm text-muted-foreground mt-1">Contact us</p>
      </div>
    );
  }

  const monthlyDisplayPrice =
    billing === "annual" && plan.annualPrice
      ? Math.round(plan.annualPrice / 12)
      : plan.monthlyPrice;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-4xl font-bold">
          ${monthlyDisplayPrice}
        </span>
        <span className="text-sm text-muted-foreground">/mo</span>
        {billing === "annual" && plan.annualPrice && (
          <span className="text-sm text-muted-foreground line-through">
            ${plan.monthlyPrice}/mo
          </span>
        )}
      </div>
      {billing === "annual" && plan.annualPrice && (
        <p className="text-sm text-muted-foreground mt-1">
          Billed ${plan.annualPrice}/yr
        </p>
      )}
      {typeof plan.seats === "number" && plan.seats > 1 && (
        <p className="text-xs text-muted-foreground mt-1">
          ${Math.round(plan.monthlyPrice / plan.seats)}/seat/mo
        </p>
      )}
    </div>
  );
}

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingCycle>("annual");

  return (
    <div className="bg-background text-foreground">
      {/* Hero */}
      <section className="text-center py-16 px-4">
        <h1 className="text-4xl font-bold">Simple, transparent pricing</h1>
        <p className="text-lg text-muted-foreground mt-4">
          Every plan includes unlimited agents, tools, and missions.
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
            <Badge variant="secondary">Save 20%</Badge>
          )}
        </div>
      </div>

      {/* Plan cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto px-4 py-12">
        {plans.map((plan) => {
          const isPopular = plan.id === "team";
          return (
            <Card
              key={plan.id}
              className={
                isPopular
                  ? "ring-2 ring-green-500 relative flex flex-col"
                  : "relative flex flex-col"
              }
            >
              {isPopular && plan.badge && (
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-0">
                  <Badge className="bg-green-500 text-white hover:bg-green-600">
                    {plan.badge}
                  </Badge>
                </div>
              )}
              <CardHeader className={isPopular ? "pt-6" : undefined}>
                <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
                <PriceDisplay plan={plan} billing={billing} />
                <p className="text-sm text-muted-foreground mt-2">
                  {plan.description}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col flex-1">
                <Separator />
                <ul className="space-y-3 mt-6 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex flex-row items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  {plan.id === "enterprise" ? (
                    <Button
                      variant={plan.cta.variant}
                      className="w-full"
                      asChild
                    >
                      <Link href="/contact-sales">{plan.cta.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      variant={plan.cta.variant}
                      className="w-full"
                      asChild
                    >
                      <Link href={`/signup?plan=${plan.id}`}>
                        {plan.cta.label}
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Trust signals */}
      <section className="flex justify-center gap-12 py-16 text-muted-foreground px-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">Designed For Security Teams</span>
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
