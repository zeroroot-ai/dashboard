"use client";

/**
 * The bank list (gibson#1706 lane E1): every bank of the active tenant the
 * caller may read, with a create dialog. CreateBank is a tenant-scoped
 * `writer` RPC, so `useAuthorize` decides the button; the daemon filters
 * the list by `can_read`.
 */

import * as React from "react";
import Link from "next/link";
import { LayersIcon, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthGatedButton } from "@/components/gibson/auth";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { useSession } from "@/src/lib/session-client";
import { useBanks } from "@/src/hooks/useBanks";
import { LOGIN_SHAPE_LABEL, ownerLabel, staleLimitLabel } from "@/src/lib/banks/view";
import { BankFormDialog } from "./BankFormDialog";

const CREATE_BANK = "/gibson.bank.v1.BankService/CreateBank";

export function BanksContent() {
  const { data: banks, isLoading, error } = useBanks();
  const { data: session } = useSession();
  const { allowed, loading } = useAuthorize(CREATE_BANK);
  const canCreate = allowed && !loading;
  const [createOpen, setCreateOpen] = React.useState(false);
  const myUserId = session?.user.id ?? null;

  const createButton = (
    <AuthGatedButton
      state={loading ? "loading" : canCreate ? "allowed" : "denied"}
      disabledTooltip="Ask a tenant admin for the writer role to declare a bank."
      size="sm"
      onClick={() => setCreateOpen(true)}
      data-testid="bank-create-open"
    >
      <Plus className="size-3.5" />
      New bank
    </AuthGatedButton>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <LayersIcon className="size-5" aria-hidden="true" />
            Banks
          </h1>
          <p className="text-sm text-muted-foreground">
            Pools of always-on Claude Code members. Give them jobs from the console or from a mission.
          </p>
        </div>
        {createButton}
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorAlert title="Could not load banks" error={error instanceof Error ? error : { message: String(error) }} />
      ) : !banks || banks.length === 0 ? (
        <EmptyState
          icon={LayersIcon}
          title="No banks yet"
          description="Declare a bank to keep Claude Code members running and ready for jobs."
          primaryCta={createButton}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="bank-list">
          {banks.map((b) => (
            <Card key={b.id} data-testid="bank-card" data-bank-id={b.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/dashboard/agents/banks/${encodeURIComponent(b.id)}`} className="font-mono hover:underline">
                    {b.name}
                  </Link>
                  <Badge variant="outline" className="text-[0.65rem]">
                    {b.desiredCount} {b.desiredCount === 1 ? "member" : "members"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <p>Owner: <span className="text-foreground">{ownerLabel(b.owner, myUserId)}</span></p>
                <p>Login: <span className="text-foreground">{LOGIN_SHAPE_LABEL[b.loginShape]}</span></p>
                {b.providerConfigName ? <p>Provider: <span className="font-mono text-foreground">{b.providerConfigName}</span></p> : null}
                <p>Model: <span className="font-mono text-foreground">{b.model || "agent default"}</span></p>
                <p>Stale limit: <span className="text-foreground">{staleLimitLabel(b.staleLimitSeconds)}</span></p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BankFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      {banks && banks.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
            <Link href="/dashboard/sandboxes">Open the console</Link>
          </Button>{" "}
          to watch members and give them jobs.
        </p>
      ) : null}
    </div>
  );
}
