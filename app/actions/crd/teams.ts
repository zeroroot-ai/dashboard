"use server";

/**
 * Team lifecycle + membership Server Actions.
 *
 * Teams are a first-class FGA type (`team`). A team carries a
 * parent:tenant tuple and member:user tuples. Per-team catalog denies
 * (team_read_disabled / team_write_disabled / team_execute_disabled on
 * component) hang off the team's member relation.
 *
 * Delete is atomic across member/admin/team_*_disabled tuples — no
 * orphan tuples remain after a team is removed. The daemon's
 * TenantAdminService.DeleteTeam handles the full FGA cleanup atomically.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 35, R8.
 */

import { MembershipService } from "@/src/gen/gibson/tenant/v1/membership_pb";
import { userClient } from "@/src/lib/gibson-client";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

export interface Team {
  id: string; // the FGA object id, e.g. "red-team"
  displayName: string;
  memberCount: number;
}

export interface TeamMember {
  userId: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
}

export async function listTeamsAction(): Promise<ActionResult<Team[]>> {
  const gate = await requireCrdSession<Team[]>({
    action: "listTeamsAction",
  });
  if (!gate.ok) return gate.result;

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant", code: "FORBIDDEN" };
  }

  // Backed by TenantAdminService.ListTeams which wraps FGA
  // ListObjects(tenant:X, parent, team) + per-team member counts.
  // Pagination is opaque at the wire level; the dashboard surfaces the full
  // list to UI consumers (the realistic per-tenant team count is well under
  // the daemon's default page size of 50). If a tenant ever exceeds that,
  // we can swap to client-side pagination without a server-action shape
  // change.
  try {
    const client = userClient(MembershipService);
    const teams: Team[] = [];
    let pageToken = "";
    do {
      const resp = await client.listTeams({
        tenantId: tenantId,
        pageToken,
        pageSize: 0, // daemon picks default
      });
      for (const t of resp.teams) {
        teams.push({
          id: t.id,
          displayName: t.displayName || t.id,
          memberCount: t.memberCount,
        });
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return { ok: true, data: teams };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}

export async function listTeamMembersAction(
  teamId: string,
): Promise<ActionResult<TeamMember[]>> {
  if (!teamId) {
    return { ok: false, error: "teamId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<TeamMember[]>({
    action: "listTeamMembersAction",
    inputKeys: ["teamId"],
  });
  if (!gate.ok) return gate.result;

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant", code: "FORBIDDEN" };
  }

  try {
    const client = userClient(MembershipService);
    const members: TeamMember[] = [];
    let pageToken = "";
    do {
      const resp = await client.listTeamMembers({
        tenantId: tenantId,
        teamId,
        pageToken,
        pageSize: 0,
      });
      for (const m of resp.members) {
        members.push({
          userId: m.userId,
          email: m.email || undefined,
          displayName: m.displayName || undefined,
          isAdmin: m.isAdmin,
        });
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return { ok: true, data: members };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}

export async function createTeamAction(input: {
  teamId: string;
  displayName: string;
}): Promise<ActionResult<Team>> {
  if (!input.teamId) {
    return { ok: false, error: "teamId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<Team>({
    action: "createTeamAction",
    inputKeys: ["teamId", "displayName"],
  });
  if (!gate.ok) return gate.result;

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant", code: "FORBIDDEN" };
  }

  try {
    const client = userClient(MembershipService);
    const resp = await client.createTeam({
      tenantId: tenantId,
      teamId: input.teamId,
      displayName: input.displayName,
    });
    const created = resp.team;
    return {
      ok: true,
      data: {
        id: created?.id ?? input.teamId,
        displayName: created?.displayName || input.displayName,
        memberCount: created?.memberCount ?? 0,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}

export async function deleteTeamAction(
  teamId: string,
): Promise<ActionResult<{ removed: number }>> {
  if (!teamId) {
    return { ok: false, error: "teamId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<{ removed: number }>({
    action: "deleteTeamAction",
    inputKeys: ["teamId"],
  });
  if (!gate.ok) return gate.result;

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant", code: "FORBIDDEN" };
  }

  try {
    const client = userClient(MembershipService);
    await client.deleteTeam({
      tenantId: tenantId,
      teamId,
    });
    return { ok: true, data: { removed: 1 } };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}

export async function addTeamMemberAction(input: {
  teamId: string;
  userId: string;
  asAdmin?: boolean;
}): Promise<ActionResult<{ applied: boolean }>> {
  if (!input.teamId || !input.userId) {
    return { ok: false, error: "teamId + userId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<{ applied: boolean }>({
    action: "addTeamMemberAction",
    inputKeys: ["teamId", "userId", "asAdmin"],
  });
  if (!gate.ok) return gate.result;

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant", code: "FORBIDDEN" };
  }

  try {
    const client = userClient(MembershipService);
    await client.addTeamMember({
      tenantId: tenantId,
      teamId: input.teamId,
      userId: input.userId,
    });
    // If the caller wants admin rights, promote after adding as member.
    if (input.asAdmin) {
      await client.setTeamAdmin({
        tenantId: tenantId,
        teamId: input.teamId,
        userId: input.userId,
        isAdmin: true,
      });
    }
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}

export async function removeTeamMemberAction(input: {
  teamId: string;
  userId: string;
}): Promise<ActionResult<{ applied: boolean }>> {
  const gate = await requireCrdSession<{ applied: boolean }>({
    action: "removeTeamMemberAction",
    inputKeys: ["teamId", "userId"],
  });
  if (!gate.ok) return gate.result;

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant", code: "FORBIDDEN" };
  }

  try {
    const client = userClient(MembershipService);
    // RemoveTeamMember atomically removes both member and admin FGA tuples
    // for the user on this team — no separate admin-tuple cleanup needed.
    await client.removeTeamMember({
      tenantId: tenantId,
      teamId: input.teamId,
      userId: input.userId,
    });
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}
