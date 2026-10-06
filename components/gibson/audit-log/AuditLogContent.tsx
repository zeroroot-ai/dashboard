// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AuditLogContent — the audit log page (lane 11 row G23).
 *
 * One row for each record: the time, the action, the actor (email and
 * subject id), the kind of actor and the target object. "Load more" reads
 * the next page with the cursor of the last one. Every visible text is in
 * ./texts.ts or is data from the daemon.
 */

import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { listAuditRecordsAction } from "@/app/actions/audit-log";
import type { AuditPageDTO } from "@/src/lib/gibson-client/audit-log";
import { AUDIT_TEXT, actorSourceText } from "./texts";

function localTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function readPage(cursor: string): Promise<AuditPageDTO> {
  const res = await listAuditRecordsAction(cursor);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function AuditLogContent() {
  const query = useInfiniteQuery({
    queryKey: ["audit-log"],
    queryFn: ({ pageParam }) => readPage(pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
  });

  const records = query.data?.pages.flatMap((p) => p.records) ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{AUDIT_TEXT.title}</h1>
        <p className="text-muted-foreground text-sm">{AUDIT_TEXT.intro}</p>
      </div>

      {query.isLoading ? (
        <TableSkeleton rows={6} />
      ) : query.error ? (
        <ErrorAlert error={query.error} />
      ) : records.length === 0 ? (
        <p className="text-sm" data-testid="audit-empty">
          {AUDIT_TEXT.empty}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{AUDIT_TEXT.columnTime}</TableHead>
                <TableHead>{AUDIT_TEXT.columnAction}</TableHead>
                <TableHead>{AUDIT_TEXT.columnActor}</TableHead>
                <TableHead>{AUDIT_TEXT.columnActorSource}</TableHead>
                <TableHead>{AUDIT_TEXT.columnTarget}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r, i) => (
                <TableRow key={`${r.timestamp}-${i}`} data-testid="audit-row">
                  <TableCell>
                    <time dateTime={r.timestamp}>{localTime(r.timestamp)}</time>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.eventType}</TableCell>
                  <TableCell>
                    {r.actorEmail && <div>{r.actorEmail}</div>}
                    <div className="text-muted-foreground font-mono text-xs">{r.actorId}</div>
                  </TableCell>
                  <TableCell>{actorSourceText(r.actorSource)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.targetObject}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {query.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {AUDIT_TEXT.loadMore}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
