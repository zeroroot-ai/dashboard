"use client";

/**
 * Shared scope selector used by /dashboard/agents, /dashboard/tools,
 * /dashboard/plugins, and the Security Policy page. Emits a
 * {scope, targetId?} structure; parent decides what to do with it.
 *
 * The secondary dropdown (team / user / agent) is populated on demand: when a
 * scope that needs a target is selected, the selector fetches the matching
 * list via its read Server Action and caches it for the component's lifetime.
 * Callers may still pass `teams` / `users` / `agents` to override the fetch
 * (e.g. tests, or a page that already has the data), a non-empty prop wins.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 28, R8;
 * dashboard#698/#699/#700 (populate per-team/-user/-agent dropdowns).
 */
import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listTeamsAction } from "@/app/actions/crd/teams";
import { listMembersAction } from "@/app/actions/read/listMembers";
import { listAgentIdentitiesAction } from "@/app/actions/read/listAgentIdentities";

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

type Option = { id: string; name: string };

export interface AccessScopeSelectorProps {
  value: AccessScopeSelection;
  onChange: (v: AccessScopeSelection) => void;
  /**
   * Teams, users, or agents the secondary dropdown picks from. When a list is
   * omitted (or empty) it is fetched on demand the first time its scope is
   * selected. A non-empty prop overrides the fetch.
   */
  teams?: Option[];
  users?: Option[];
  agents?: Option[];
}

type LoadState = "idle" | "loading" | "loaded" | "error";

export function AccessScopeSelector({
  value,
  onChange,
  teams,
  users,
  agents,
}: AccessScopeSelectorProps) {
  const [targetId, setTargetId] = useState(value.targetId ?? "");

  // On-demand fetched lists. A non-empty prop short-circuits the fetch.
  const [fetchedTeams, setFetchedTeams] = useState<Option[]>([]);
  const [fetchedUsers, setFetchedUsers] = useState<Option[]>([]);
  const [fetchedAgents, setFetchedAgents] = useState<Option[]>([]);
  const [teamsState, setTeamsState] = useState<LoadState>("idle");
  const [usersState, setUsersState] = useState<LoadState>("idle");
  const [agentsState, setAgentsState] = useState<LoadState>("idle");

  const teamsProvided = (teams?.length ?? 0) > 0;
  const usersProvided = (users?.length ?? 0) > 0;
  const agentsProvided = (agents?.length ?? 0) > 0;

  // Guard against re-fetching the same list on every render. We can't gate on
  // the load-state here because mutating it would re-run this effect and
  // cancel the in-flight request before it stores its result.
  const requested = useRef({ team: false, user: false, agent: false });

  // Fetch the list for the active scope the first time it is selected.
  useEffect(() => {
    let cancelled = false;
    if (value.scope === "per-team" && !teamsProvided && !requested.current.team) {
      requested.current.team = true;
      setTeamsState("loading");
      listTeamsAction()
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            setFetchedTeams(
              r.data.map((t) => ({ id: t.id, name: t.displayName || t.id })),
            );
            setTeamsState("loaded");
          } else {
            setTeamsState("error");
          }
        })
        .catch(() => !cancelled && setTeamsState("error"));
    }
    if (value.scope === "per-user" && !usersProvided && !requested.current.user) {
      requested.current.user = true;
      setUsersState("loading");
      listMembersAction()
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            setFetchedUsers(
              r.data.map((m) => ({
                id: m.userId,
                name: m.displayName || m.email || m.userId,
              })),
            );
            setUsersState("loaded");
          } else {
            setUsersState("error");
          }
        })
        .catch(() => !cancelled && setUsersState("error"));
    }
    if (
      value.scope === "per-agent" &&
      !agentsProvided &&
      !requested.current.agent
    ) {
      requested.current.agent = true;
      setAgentsState("loading");
      listAgentIdentitiesAction()
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            setFetchedAgents(r.data);
            setAgentsState("loaded");
          } else {
            setAgentsState("error");
          }
        })
        .catch(() => !cancelled && setAgentsState("error"));
    }
    return () => {
      cancelled = true;
    };
  }, [value.scope, teamsProvided, usersProvided, agentsProvided]);

  const effectiveTeams = teamsProvided ? teams! : fetchedTeams;
  const effectiveUsers = usersProvided ? users! : fetchedUsers;
  const effectiveAgents = agentsProvided ? agents! : fetchedAgents;

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
        <TargetSelect
          value={targetId}
          onValueChange={updateTarget}
          options={effectiveTeams}
          state={teamsState}
          noun="team"
        />
      )}
      {value.scope === "per-user" && (
        <TargetSelect
          value={targetId}
          onValueChange={updateTarget}
          options={effectiveUsers}
          state={usersState}
          noun="user"
        />
      )}
      {value.scope === "per-agent" && (
        <TargetSelect
          value={targetId}
          onValueChange={updateTarget}
          options={effectiveAgents}
          state={agentsState}
          noun="agent"
        />
      )}
    </div>
  );
}

function TargetSelect({
  value,
  onValueChange,
  options,
  state,
  noun,
}: {
  value: string;
  onValueChange: (id: string) => void;
  options: Option[];
  state: LoadState;
  noun: string;
}) {
  const empty = options.length === 0;
  return (
    <Select value={value} onValueChange={onValueChange} disabled={empty}>
      <SelectTrigger className="w-48">
        <SelectValue
          placeholder={
            state === "loading"
              ? `Loading ${noun}s…`
              : state === "error"
                ? `Failed to load ${noun}s`
                : empty
                  ? `No ${noun}s available`
                  : `Select ${noun}`
          }
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
