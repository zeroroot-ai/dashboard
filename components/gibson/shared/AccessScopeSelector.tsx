"use client";

/**
 * Shared scope selector used by /dashboard/agents, /dashboard/tools,
 * /dashboard/plugins, and the new Security Policy page. Emits a
 * {scope, targetId?} structure; parent decides what to do with it.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 28, R8.
 */
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AccessScope =
  | "tenant-wide"
  | "per-team"
  | "per-user"
  | "per-agent"
  | "my-access";

export type AccessScopeSelection = {
  scope: AccessScope;
  targetId?: string; // team id, user id, or component id depending on scope
};

export interface AccessScopeSelectorProps {
  value: AccessScopeSelection;
  onChange: (v: AccessScopeSelection) => void;
  /** Teams, users, or components the secondary dropdown picks from. */
  teams?: { id: string; name: string }[];
  users?: { id: string; name: string }[];
  agents?: { id: string; name: string }[];
}

export function AccessScopeSelector({
  value,
  onChange,
  teams = [],
  users = [],
  agents = [],
}: AccessScopeSelectorProps) {
  const [targetId, setTargetId] = useState(value.targetId ?? "");

  function updateScope(scope: AccessScope) {
    onChange({ scope, targetId: targetId || undefined });
  }
  function updateTarget(id: string) {
    setTargetId(id);
    onChange({ scope: value.scope, targetId: id || undefined });
  }

  return (
    <div className="flex items-center gap-3">
      <Tabs value={value.scope} onValueChange={(s) => updateScope(s as AccessScope)}>
        <TabsList>
          <TabsTrigger value="tenant-wide">Tenant-wide</TabsTrigger>
          <TabsTrigger value="per-team">Per-team</TabsTrigger>
          <TabsTrigger value="per-user">Per-user</TabsTrigger>
          <TabsTrigger value="per-agent">Per-agent</TabsTrigger>
          <TabsTrigger value="my-access">My access</TabsTrigger>
        </TabsList>
      </Tabs>
      {value.scope === "per-team" && (
        <Select value={targetId} onValueChange={updateTarget}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Select team" /></SelectTrigger>
          <SelectContent>
            {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {value.scope === "per-user" && (
        <Select value={targetId} onValueChange={updateTarget}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Select user" /></SelectTrigger>
          <SelectContent>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {value.scope === "per-agent" && (
        <Select value={targetId} onValueChange={updateTarget}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Select agent" /></SelectTrigger>
          <SelectContent>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
