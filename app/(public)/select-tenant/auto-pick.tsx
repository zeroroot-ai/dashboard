"use client";

import { useEffect, useRef } from "react";

/**
 * Single-membership auto-pick. Server components cannot mutate cookies
 * (Next.js 15+ restriction), so the auto-redirect that used to call
 * setActiveTenant() directly from the page now renders this component
 * for the single-membership case. It immediately submits a hidden form
 * targeting `pickTenantAction` (a Server Action) on mount, which sets
 * the gibson_active_tenant cookie and redirects.
 */
interface AutoPickTenantProps {
  tenantId: string;
  tenantName: string;
  returnTo: string;
  action: (formData: FormData) => Promise<void>;
}

export function AutoPickTenant({
  tenantId,
  tenantName,
  returnTo,
  action,
}: AutoPickTenantProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.requestSubmit();
  }, []);

  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="text-muted-foreground">
        Continuing as <span className="font-medium">{tenantName}</span>…
      </p>
      <form ref={formRef} action={action} className="hidden">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="return_to" value={returnTo} />
      </form>
    </div>
  );
}
