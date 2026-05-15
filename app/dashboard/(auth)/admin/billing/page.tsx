import { listTenants } from '@/src/lib/k8s/tenants';
import {
  assertAuthorized,
  AuthzDeniedError,
} from '@/src/lib/auth/assert-authorized';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { BillingStatus } from '@/src/lib/k8s/types';

/**
 * Billing status badge — coloured by state.
 * Stripe customer ID is NOT shown per NFR-S2.
 */
function BillingStatusBadge({ status }: { status?: BillingStatus['status'] }) {
  if (!status) {
    return <Badge variant="secondary">No billing</Badge>;
  }

  const variants: Record<NonNullable<BillingStatus['status']>, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    trialing: 'outline',
    active: 'default',
    past_due: 'destructive',
    cancelled: 'secondary',
    incomplete: 'outline',
    incomplete_expired: 'destructive',
  };

  const labels: Record<NonNullable<BillingStatus['status']>, string> = {
    trialing: 'Trial',
    active: 'Active',
    past_due: 'Past due',
    cancelled: 'Cancelled',
    incomplete: 'Incomplete',
    incomplete_expired: 'Expired',
  };

  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

/**
 * Format a trial end date for display, or return '—' if absent.
 */
function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * /dashboard/admin/billing — read-only billing overview for platform operators.
 *
 * Shows all tenants with their billing status. Server component gated on
 * platform-operator authz. Stripe customer IDs are NOT shown (NFR-S2);
 * only the Stripe Dashboard link is rendered.
 *
 * Spec: stripe-billing-integration R9.3, NFR-S2.
 */
export default async function AdminBillingPage() {
  // Auth gate: platform-operator only.
  try {
    await assertAuthorized('/gibson.admin.v1.PluginsAdminService/RegisterPlugin');
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      // The layout error boundary will catch this and render an access-denied page.
      throw err;
    }
    throw err;
  }

  const tenants = await listTenants();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Billing overview</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Read-only view of all tenant billing states. Stripe customer IDs are not
        displayed here — use the Stripe Dashboard link for customer details.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tenant</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>Billing status</TableHead>
            <TableHead>Trial end</TableHead>
            <TableHead>Period end</TableHead>
            <TableHead>Past due since</TableHead>
            <TableHead>Stripe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => {
            const billing = tenant.status?.billing;
            const customerId = billing?.customerId;
            return (
              <TableRow key={tenant.metadata.name}>
                <TableCell className="font-medium">{tenant.metadata.name}</TableCell>
                <TableCell>{tenant.spec.tier}</TableCell>
                <TableCell>
                  <BillingStatusBadge status={billing?.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(billing?.trialEnd)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(billing?.currentPeriodEnd)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(billing?.pastDueSince)}
                </TableCell>
                <TableCell>
                  {customerId ? (
                    <a
                      href={`https://dashboard.stripe.com/customers/${customerId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-link hover:text-link underline"
                    >
                      View in Stripe
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {tenants.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No tenants found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
