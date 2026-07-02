"use client";

/**
 * SessionsTable, the "My active sessions" surface on Settings → CLI
 * (PRD dashboard#738, slices S3 read-only + S4 revoke).
 *
 * Lists the caller's own login sessions (browser / CLI), marks the current
 * one "this device", and lets the user revoke a single session behind a
 * confirmation step. Presentation-only over the self-scoped server actions.
 */

import { useCallback, useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorAlert } from "@/components/gibson/shared";
import {
  listMySessionsAction,
  revokeMySessionAction,
  type MySession,
} from "@/app/actions/sessions/mySessions";

function formatWhen(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

export function SessionsTable() {
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<MySession | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await listMySessionsAction();
    if (r.ok) {
      setSessions(r.data);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmRevoke() {
    if (!toRevoke) return;
    setRevoking(true);
    const r = await revokeMySessionAction(toRevoke.id);
    setRevoking(false);
    setToRevoke(null);
    if (r.ok) {
      await load();
    } else {
      setError(r.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">My active sessions</CardTitle>
        <CardDescription>
          Everywhere you are currently signed in. Revoke a session to sign that
          browser or CLI out immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : error ? (
          <ErrorAlert error={{ message: error }} />
        ) : sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active sessions.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>IP address</TableHead>
                <TableHead>Signed in</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {s.browser || "Unknown client"}
                      {s.isCurrent && <Badge variant="secondary">This device</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{s.ip || "-"}</TableCell>
                  <TableCell className="text-sm">{formatWhen(s.createdAt)}</TableCell>
                  <TableCell className="text-sm">{formatWhen(s.lastActiveAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setToRevoke(s)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog
        open={toRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setToRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRevoke?.isCurrent
                ? "This is the session you are using right now, revoking it will sign you out of this device."
                : "The selected browser or CLI will be signed out immediately and cannot mint new tokens."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke} disabled={revoking}>
              {revoking ? "Revoking…" : "Revoke session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
