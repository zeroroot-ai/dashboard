import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";

/**
 * 404 page.
 *
 * The "Contact support" button is SaaS-only (dashboard#924 / PRD dashboard#920):
 * it links to `${marketingUrl}/contact-sales`. On self-hosted (marketingUrl
 * null) the button is omitted entirely so no dead off-cluster URL is rendered.
 */
export default function NotFound() {
  // Resolve the deployment posture at the server boundary.
  // marketingUrl is null on self-hosted (WWW_URL unset), non-null on SaaS.
  // dashboard#924 / PRD dashboard#920 / deploy ADR-0006.
  const { marketingUrl } = getDeploymentProfile();

  return (
    <div className="bg-background grid h-screen items-center pb-8 lg:grid-cols-2 lg:pb-0">
      <div className="text-center">
        <p className="text-muted-foreground text-base font-semibold">404</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl lg:text-7xl">
          Page not found
        </h1>
        <p className="text-muted-foreground mt-6 text-base leading-7">
          Sorry, we couldn&apos;t find the page you&apos;re looking for.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-2">
          <Button size="lg" asChild>
            <Link href="/dashboard">Go back home</Link>
          </Button>
          {/* Contact support link is SaaS-only (dashboard#924). Omitted on
              self-hosted (marketingUrl null) so there is never a dead link. */}
          {marketingUrl !== null && (
            <Button size="lg" variant="ghost" asChild>
              <Link href={`${marketingUrl}/contact-sales`}>
                Contact support <ArrowRight className="ms-2 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div className="hidden lg:block">
        <img
          src="/404.svg"
          width={300}
          height={400}
          className="w-full object-contain lg:max-w-2xl"
          alt="not found image"
        />
      </div>
    </div>
  );
}
