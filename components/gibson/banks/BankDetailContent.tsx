"use client";

/**
 * One bank (gibson#1706 lane E1): its facts, the edit and delete actions for
 * its owner, and the member list. `can_read` is the daemon's decision: a bank
 * the caller may not read is a 404 here. `owner` is derived from the bank's
 * owner and the caller's tenant role (useBankPermissions), because the bank
 * RPCs are object-scoped and `useAuthorize` cannot decide them.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { useSession } from "@/src/lib/session-client";
import { useBank, useBankMembers } from "@/src/hooks/useBanks";
import { useBankPermissions } from "@/src/hooks/useBankPermissions";
import {
  LOGIN_SHAPE_LABEL,
  SPILL_POLICY_LABEL,
  ownerLabel,
  staleLimitLabel,
  type MemberView,
} from "@/src/lib/banks/view";
import { BankFormDialog } from "./BankFormDialog";
import { DeleteBankDialog } from "./DeleteBankDialog";
import { MemberList } from "./MemberList";
import { SignInAction } from "./SignInPanel";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-xs text-foreground">{value}</dd>
    </div>
  );
}

interface BankDetailContentProps {
  bankId: string;
}

export function BankDetailContent({ bankId }: BankDetailContentProps) {
  const router = useRouter();
  const { data: bank, isLoading, error } = useBank(bankId);
  const { data: members } = useBankMembers(bankId);
  const { data: session } = useSession();
  const { canManage } = useBankPermissions(bank?.owner);
  const [editOpen, setEditOpen] = React.useState(false);

  if (isLoading) return <TableSkeleton />;
  if (error || !bank) {
    return (
      <div className="space-y-3">
        <BackLink />
        <ErrorAlert title="Could not load bank" error={error instanceof Error ? error : { message: "Bank not found" }} />
      </div>
    );
  }

  const memberRows = members ?? [];
  const running = memberRows.filter((m) => m.state !== "dead" && m.state !== "launching").length;

  return (
    <div className="space-y-4">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold">
            {bank.name}
            <Badge variant="outline" className="text-[0.65rem]" data-testid="bank-member-count">
              {running}/{bank.desiredCount} running
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {LOGIN_SHAPE_LABEL[bank.loginShape]}
            {bank.providerConfigName ? ` on ${bank.providerConfigName}` : ""}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2" data-testid="bank-manage-actions">
            <Button type="button" size="sm" variant="outline" className="text-xs" onClick={() => setEditOpen(true)} data-testid="bank-edit">
              <Pencil className="size-3" />
              Edit
            </Button>
            <DeleteBankDialog bank={bank} members={memberRows} onDeleted={() => router.push("/dashboard/agents/banks")} />
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Bank</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact label="owner" value={ownerLabel(bank.owner, session?.user.id ?? null)} />
            <Fact label="agent" value={<span className="font-mono">{bank.agentName || "claude"}</span>} />
            <Fact label="model" value={<span className="font-mono">{bank.model || "agent default"}</span>} />
            <Fact label="jobs in flight per member" value={bank.maxJobsInFlight || "daemon default"} />
            <Fact label="stale limit" value={staleLimitLabel(bank.staleLimitSeconds)} />
            <Fact label="when no member is free" value={SPILL_POLICY_LABEL[bank.spillPolicy]} />
            <Fact label="bank id" value={<span className="font-mono break-all">{bank.id}</span>} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <MemberList
            members={memberRows}
            // The sign-in relay (dashboard#1169): the owner drives it, on a
            // member that waits for the sign-in. The subscription is theirs.
            renderAction={
              canManage
                ? (m: MemberView) => (m.state === "needs_sign_in" ? <SignInAction bankId={bank.id} member={m} /> : null)
                : undefined
            }
          />
        </CardContent>
      </Card>

      <BankFormDialog open={editOpen} onOpenChange={setEditOpen} bank={bank} />
    </div>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
      <Link href="/dashboard/agents/banks">
        <ArrowLeft className="size-3.5" />
        Banks
      </Link>
    </Button>
  );
}
