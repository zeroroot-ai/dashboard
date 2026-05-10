'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface CheckoutButtonProps {
  /** The billing tier ID (e.g. "squad", "org", "platform"). */
  tier: string;
  /** Button label text. */
  label: string;
  /** Shadcn Button variant. */
  variant?: 'default' | 'outline' | 'secondary';
  /** Disable the button externally (e.g. while parent is loading). */
  disabled?: boolean;
  /**
   * When true, POSTs to /api/billing/portal instead of /api/billing/checkout.
   * Used for the "Manage billing" button on the billing settings page.
   */
  portalMode?: boolean;
}

/**
 * CheckoutButton — client component that POSTs to /api/billing/checkout
 * (or /api/billing/portal when portalMode=true) and redirects to the
 * returned URL.
 *
 * Shows a loading state while the request is in flight. Displays a toast
 * on error.
 *
 * Security: the URL is consumed directly via window.location.href without
 * being stored in React state — avoids any XSS surface from a malformed URL.
 */
export function CheckoutButton({
  tier,
  label,
  variant = 'default',
  disabled = false,
  portalMode = false,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);

    try {
      const endpoint = portalMode
        ? '/api/billing/portal'
        : '/api/billing/checkout';

      const body = portalMode ? {} : { tier };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const msg = data?.error ?? 'Unable to start checkout — please try again';
        toast.error(msg);
        setLoading(false);
        return;
      }

      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        toast.error('Unable to start checkout — please try again');
        setLoading(false);
        return;
      }

      // Navigate directly — don't store URL in state.
      window.location.href = data.url;
      // Keep loading=true during navigation to prevent double-submit.
    } catch {
      toast.error('Unable to start checkout — please try again');
      setLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      className="w-full"
      disabled={disabled || loading}
      onClick={handleClick}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading…
        </>
      ) : (
        label
      )}
    </Button>
  );
}
