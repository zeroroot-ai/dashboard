// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Panel 3 of the first screen: what the agents did and who allowed it
 * (dashboard#385). The daemon groups the connector calls of the last 24 hours
 * by the grant that allowed each one and by the person who gave the grant. A
 * refused call shows the grant that it lacked.
 *
 * ListActionsByGrant returns no audit record ids. A row links to the audit log
 * page. That page has no filter by time yet, so the row shows the first and the
 * last time of its actions for the reader.
 */

import * as React from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useActionsByGrant } from "@/src/hooks/useActionsByGrant";
import { useSession } from "@/src/lib/session-client";
import { useUserRefs } from "@/src/hooks/useUserRefs";
import { grantLabel, type ActionGroupView } from "@/src/lib/actions/actions-by-grant";
import { principalLabel, userIdsToResolve } from "@/src/lib/principals/label";
import { ACTIONS_TEXT } from "./texts";

const AUDIT_LOG_HREF = "/dashboard/organization/audit-log";

function localTime(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : ACTIONS_TEXT.unknown;
}

export function ActionsPanel() {
  const { data, isLoading, error, refetch } = useActionsByGrant();
  const { data: session } = useSession();
  const myUserId = session?.user.id ?? null;
  const groups = data?.groups ?? [];
  const grantorIds = React.useMemo(
    () => userIdsToResolve(groups.map((g) => (g.grantor ? { kind: "user" as const, id: g.grantor } : undefined)), myUserId),
    [groups, myUserId],
  );
  const { data: userRefs } = useUserRefs(grantorIds);

  const grantor = (g: ActionGroupView): string =>
    g.grantor ? principalLabel({ kind: "user", id: g.grantor }, myUserId, userRefs) : ACTIONS_TEXT.noGrantor;

  return (
    <Card className="glass-hack border-highlight/40" data-testid="panel-actions">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            {ACTIONS_TEXT.title}
          </CardTitle>
          <ShieldCheckIcon className="h-4 w-4 text-highlight opacity-70" aria-hidden="true" />
        </div>
        <p className="text-xs text-muted-foreground">{ACTIONS_TEXT.period}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : error ? (
          <ErrorAlert error={error} title={ACTIONS_TEXT.loadFailed} retry={() => void refetch()} />
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="actions-empty">
            {ACTIONS_TEXT.empty}
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g, i) => (
              <li
                key={`${g.grantObject}|${g.grantRelation}|${g.grantor}|${g.refused}|${i}`}
                className="space-y-1 rounded border border-border px-3 py-2"
                data-testid="action-group"
                data-refused={g.refused ? "true" : "false"}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs" data-testid="action-group-grant">
                      {grantLabel(g) || ACTIONS_TEXT.noGrant}
                    </Badge>
                    {g.refused && (
                      <Badge className="border border-destructive/40 bg-destructive/10 text-destructive text-xs">
                        {ACTIONS_TEXT.refused}
                      </Badge>
                    )}
                    <span className="text-sm font-medium tabular-nums" data-testid="action-group-count">
                      {ACTIONS_TEXT.count(g.count)}
                    </span>
                  </div>
                  <Link
                    href={AUDIT_LOG_HREF}
                    className="text-xs underline underline-offset-2 hover:text-highlight"
                    data-testid="action-group-audit"
                  >
                    {ACTIONS_TEXT.openAudit}
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground" data-testid="action-group-grantor">
                  {g.refused ? ACTIONS_TEXT.lacked : `${ACTIONS_TEXT.grantor}: ${grantor(g)}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ACTIONS_TEXT.agents}: {g.agents.join(", ") || ACTIONS_TEXT.unknown}.{" "}
                  {ACTIONS_TEXT.tools}: {g.tools.join(", ") || ACTIONS_TEXT.unknown}.
                </p>
                <p className="text-xs text-muted-foreground">
                  {localTime(g.first)} - {localTime(g.last)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {data?.truncated && (
          <p className="text-xs text-muted-foreground" data-testid="actions-truncated">
            {ACTIONS_TEXT.truncated}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
