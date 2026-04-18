"use client";

/**
 * /dashboard/device — the user-facing page that completes the Device
 * Authorization Grant. User enters the code printed by `gibson-mcp
 * login`, signs in if needed, and clicks Approve. On success the
 * browser tells gibson-mcp it can stop polling.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 44 + R1 AC 1.
 */
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/src/lib/session-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function DevicePage() {
  const params = useSearchParams();
  const { data: session, isPending: isLoading } = useSession();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function approve() {
    if (!session?.user) {
      toast.error("Sign in first, then return to this page.");
      return;
    }
    if (!code.trim()) {
      toast.error("Enter the code printed by gibson-mcp login.");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_code: code.trim().toUpperCase() }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setDone(true);
      toast.success("Approved. You can return to your terminal.");
    } catch (err) {
      toast.error(`Approval failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <div className="p-8">Loading…</div>;

  return (
    <div className="max-w-lg mx-auto p-8">
      <Card>
        <CardHeader>
          <CardTitle>Approve Claude Code access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the code <code className="font-mono">gibson-mcp login</code> printed
            in your terminal, then click Approve.
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            className="font-mono"
            disabled={done}
          />
          <Button onClick={approve} disabled={submitting || done} className="w-full">
            {done ? "Approved — return to terminal" : submitting ? "Approving…" : "Approve"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
