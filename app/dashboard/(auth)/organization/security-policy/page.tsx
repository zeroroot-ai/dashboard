import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheckIcon } from "lucide-react";
import { SecurityPolicyContent } from "@/components/gibson/organization/SecurityPolicyContent";

export default function SecurityPolicyPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Security policy</h1>
        <p className="text-sm text-muted-foreground">
          Tenant-wide, per-team, and per-user denies for plugins, tools, and
          agents.
        </p>
      </div>

      <Card className="border-highlight/30 bg-card/40">
        <CardContent className="flex gap-3 py-4 text-sm">
          <ShieldCheckIcon
            className="size-5 shrink-0 text-highlight"
            aria-hidden="true"
          />
          <div className="space-y-2 text-muted-foreground">
            <p className="font-medium text-foreground">
              How deny-wins composition works
            </p>
            <p>
              Every toggle on this page is a <em>deny</em> at some scope. The
              runtime evaluates a deny at every layer — tenant-wide, per-team,
              per-user, and per-component — and refuses the action if any
              layer denies it. A tenant admin who flips a tenant-wide deny on
              a plugin disables it everywhere; a per-team deny narrows the
              effect to that team only.
            </p>
            <p>
              If a user reports unexpected access, check this page for the
              relevant scope and component. The matrix is the canonical view —
              there is no separate per-user override that bypasses it.{" "}
              <Link href="/docs/rbac" className="text-link hover:underline">
                Read more about roles and permissions
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>

      <SecurityPolicyContent />
    </div>
  );
}
