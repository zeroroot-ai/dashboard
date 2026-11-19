// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * SharedAgentSkills. The list of the Agent Skills that the operator offers,
 * with an Enable button for each one that the tenant does not hold yet.
 */

import * as React from "react";
import { toast } from "sonner";

import { enableSharedAgentSkillAction } from "@/app/actions/agent-skills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SharedAgentSkillDTO } from "@/src/lib/gibson-client/agent-skill-types";
import { shortDigest } from "@/src/lib/agent-skills/view";
import { AGENT_SKILL_TEXT as T } from "./texts";

export function SharedAgentSkills({
  entries,
  onChanged,
}: {
  entries: SharedAgentSkillDTO[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  async function enable(name: string) {
    setBusy(name);
    try {
      const res = await enableSharedAgentSkillAction(name);
      if (!res.ok) {
        toast.error(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(T.enabled(name));
      onChanged();
    } catch {
      toast.error(T.enableFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{T.sharedIntro}</p>
      {entries.length === 0 ? (
        <p data-testid="shared-empty" className="text-muted-foreground text-sm">
          {T.sharedEmpty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.columnName}</TableHead>
              <TableHead>{T.columnDescription}</TableHead>
              <TableHead>{T.columnDigest}</TableHead>
              <TableHead>{T.columnEnabled}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((s) => (
              <TableRow key={s.name} data-testid="shared-row">
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="max-w-md whitespace-normal">{s.description}</TableCell>
                <TableCell className="font-mono text-xs">{shortDigest(s.digest)}</TableCell>
                <TableCell>
                  {s.enabled ? (
                    <Badge variant="success">{T.stateEnabled}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === s.name}
                      aria-label={`${T.enableButton} ${s.name}`}
                      onClick={() => void enable(s.name)}
                    >
                      {busy === s.name ? T.enabling : T.enableButton}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
