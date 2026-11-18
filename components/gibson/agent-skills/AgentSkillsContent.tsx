// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AgentSkillsContent. The list page of the Agent Skills of the tenant. It
 * shows the current version of each name with its short digest, its publish
 * time and its source, a form to publish a new version, and a tab for the
 * Shared Agent Skills that the operator offers.
 *
 * Each RPC of the service needs the tenant "admin" relation. The nav entry
 * and the page hide from other roles. The server actions and the daemon
 * check the relation again.
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  listAgentSkillsAction,
  listSharedAgentSkillsAction,
} from "@/app/actions/agent-skills";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AgentSkillDTO,
  SharedAgentSkillDTO,
} from "@/src/lib/gibson-client/agent-skill-types";
import { agentSkillSource, formatPublishedAt, shortDigest } from "@/src/lib/agent-skills/view";
import { PublishAgentSkillForm } from "./PublishAgentSkillForm";
import { SharedAgentSkills } from "./SharedAgentSkills";
import { AGENT_SKILL_TEXT as T } from "./texts";

interface Loaded {
  entries: AgentSkillDTO[];
  shared: SharedAgentSkillDTO[];
}

async function readAll(): Promise<Loaded | { error: string }> {
  try {
    const [mine, shared] = await Promise.all([
      listAgentSkillsAction(),
      listSharedAgentSkillsAction(),
    ]);
    if (!mine.ok) return { error: mine.error || T.loadError };
    if (!shared.ok) return { error: shared.error || T.loadError };
    return { entries: mine.data, shared: shared.data };
  } catch {
    return { error: T.loadError };
  }
}

export function AgentSkillsContent() {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const apply = React.useCallback((r: Awaited<ReturnType<typeof readAll>>) => {
    if ("error" in r) {
      setError(r.error);
    } else {
      setError(null);
      setData(r);
    }
  }, []);

  const reload = React.useCallback(() => {
    setError(null);
    void readAll().then(apply);
  }, [apply]);

  React.useEffect(() => {
    void readAll().then(apply);
  }, [apply]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{T.intro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.publishTitle}</CardTitle>
          <CardDescription>{T.publishIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          <PublishAgentSkillForm
            onPublished={(_entry, name) => {
              toast.success(T.published(name));
              reload();
            }}
          />
        </CardContent>
      </Card>

      {error ? (
        <ErrorAlert error={{ message: error }} title={T.loadError} retry={reload} />
      ) : data === null ? (
        <TableSkeleton />
      ) : (
        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">{T.tabMine}</TabsTrigger>
            <TabsTrigger value="shared">{T.tabShared}</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="mt-4">
            {data.entries.length === 0 ? (
              <p data-testid="agent-skills-empty" className="text-muted-foreground text-sm">
                {T.empty}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.columnName}</TableHead>
                    <TableHead>{T.columnDescription}</TableHead>
                    <TableHead>{T.columnDigest}</TableHead>
                    <TableHead>{T.columnPublished}</TableHead>
                    <TableHead>{T.columnSource}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.map((e) => {
                    const source = agentSkillSource(e, data.shared);
                    return (
                      <TableRow key={`${e.name}@${e.digest}`} data-testid="agent-skill-row">
                        <TableCell className="font-medium">
                          <Link
                            href={`/dashboard/agent-skills/${encodeURIComponent(e.name)}`}
                            className="text-link underline-offset-2 hover:underline"
                          >
                            {e.name}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal">{e.description}</TableCell>
                        <TableCell className="font-mono text-xs">{shortDigest(e.digest)}</TableCell>
                        <TableCell>{formatPublishedAt(e.publishedAt)}</TableCell>
                        <TableCell>
                          <Badge variant={source === "shared" ? "info" : "outline"}>
                            {source === "shared" ? T.sourceShared : T.sourceTenant}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>
          <TabsContent value="shared" className="mt-4">
            <SharedAgentSkills entries={data.shared} onChanged={reload} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
