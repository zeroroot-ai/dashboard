"use client";

/**
 * /dashboard/device, branded landing for the OAuth2 Device Authorization
 * Grant that `gibson login` runs.
 *
 * Post ADR-0043 the device grant is owned by the Gibson identity service
 * (native device-grant app), NOT by the dashboard. The dashboard no longer
 * mints or approves device tokens itself, the old dashboard-as-authority
 * flow (device-auth-store + /api/auth/device/approve) is retired. This page is
 * now a thin, on-brand entry point: it confirms the user_code printed in the
 * terminal and hands it off to the identity service's verification page, which
 * performs authentication + consent.
 */
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/**
 * Build the identity-service device-verification URL. The Gibson identity
 * service exposes device verification at `<issuer>/device`; passing the
 * user_code pre-fills its form. Returns null when the issuer is unconfigured.
 */
function verificationUrl(userCode: string): string | null {
  const base = process.env.NEXT_PUBLIC_IDENTITY_PROVIDER_URL;
  if (!base) return null;
  const u = new URL("/device", base);
  if (userCode) u.searchParams.set("user_code", userCode);
  return u.toString();
}

function DeviceApproval() {
  const params = useSearchParams();
  // The verification_uri_complete the CLI prints carries `user_code`; accept
  // the legacy `code` alias too.
  const initial = params.get("user_code") ?? params.get("code") ?? "";
  const [code, setCode] = useState(initial);

  const target = useMemo(() => verificationUrl(code.trim().toUpperCase()), [code]);

  function approve() {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error("Enter the code printed by gibson login.");
      return;
    }
    const url = verificationUrl(trimmed.toUpperCase());
    if (!url) {
      toast.error("Identity service is not configured. Contact your administrator.");
      return;
    }
    // Hand off to the identity service for authentication + consent.
    window.location.assign(url);
  }

  return (
    <div className="mx-auto max-w-lg p-8">
      <Card>
        <CardHeader>
          <CardTitle>Connect the Gibson CLI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the code that{" "}
            <code className="font-mono text-foreground">gibson login</code> printed
            in your terminal, then continue to approve access. You&apos;ll confirm
            with the Gibson identity service and can return to your terminal once
            it&apos;s done.
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            className="font-mono uppercase"
            autoFocus
            aria-label="Device code"
            onKeyDown={(e) => {
              if (e.key === "Enter") approve();
            }}
          />
          <Button onClick={approve} disabled={!target} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// useSearchParams() must sit under a Suspense boundary or static prerender of
// this route fails.
export default function DevicePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <DeviceApproval />
    </Suspense>
  );
}
