import { SecurityPolicyContent } from "@/components/gibson/organization/SecurityPolicyContent";

export default function SecurityPolicyPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Security policy</h1>
      <p className="text-sm text-muted-foreground">
        Tenant-wide, per-team, and per-user denies for plugins, tools, and
        agents. Deny-wins composes across every layer — the runtime denies
        any action denied at any scope.
      </p>
      <SecurityPolicyContent />
    </div>
  );
}
