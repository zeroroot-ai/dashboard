'use client';

/**
 * /login/tenant-picker
 *
 * Shown after a successful sign-in when the user belongs to more than one
 * organization (i.e. session.user.tenants.length > 1).
 *
 * Single-tenant users are never redirected here — the middleware or Better
 * Auth callbacks auto-select their only tenant and send them straight to the
 * dashboard.
 *
 * On tenant selection the page:
 *   1. POSTs to /api/tenant/select to write the gibson_current_tenant cookie.
 *   2. Redirects to /dashboard (or the original destination from ?from=).
 *
 * Keyboard navigation: the list items are focusable via Tab; Enter / Space
 * trigger selection.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/src/lib/session-client';
import { signOutAction } from '@/app/actions/auth/signout';
import { useEffect, useState, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatTenantName(alias: string): string {
  return alias
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function TenantPickerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();
  const status = isPending ? 'loading' : session ? 'authenticated' : 'unauthenticated';
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = searchParams?.get('from') ?? '/dashboard';

  // If session is loading, show nothing yet.
  if (status === 'loading') {
    return null;
  }

  // No session → redirect to login.
  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenants: string[] = (session?.user as any)?.tenants ?? [];

  // Single-tenant user: skip the picker entirely and go straight to the
  // destination. The /api/tenant/select call from the post-signin flow will
  // have already set the cookie; we just redirect without showing the UI.
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (tenants.length <= 1) {
      const singleTenant = tenants[0];
      if (singleTenant) {
        // Set the tenant cookie then navigate — keeps the same flow as
        // multi-tenant selection so middleware sees the cookie immediately.
        selectTenant(singleTenant, from);
      } else {
        router.replace(from);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function selectTenant(alias: string, destination: string) {
    setSelecting(alias);
    setError(null);
    try {
      const res = await fetch('/api/tenant/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: alias }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select tenant');
      setSelecting(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Choose Organization</CardTitle>
          <CardDescription>
            You belong to multiple organizations. Select the one you want to work in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div
              className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          )}
          <ul
            className="space-y-2"
            role="list"
            aria-label="Available organizations"
          >
            {tenants.sort().map((alias) => (
              <li key={alias}>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left h-auto py-3 px-4"
                  onClick={() => selectTenant(alias, from)}
                  disabled={selecting !== null}
                  aria-busy={selecting === alias}
                  aria-label={`Select organization ${formatTenantName(alias)}`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold">{formatTenantName(alias)}</span>
                    <span className="text-xs text-muted-foreground font-mono">{alias}</span>
                  </span>
                  {selecting === alias && (
                    <span className="ml-auto text-xs text-muted-foreground animate-pulse">
                      Selecting…
                    </span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TenantPickerPage() {
  return (
    <Suspense>
      <TenantPickerContent />
    </Suspense>
  );
}
