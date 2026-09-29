// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The four tenant roles (ADR-0093 decision 2), in one place.
 *
 * The daemon speaks FGA relation names: `owner`, `admin`, `writer`, `member`.
 * People read the ADR vocabulary: Owner, Admin, Editor, Viewer. Every role
 * control and badge in the dashboard renders the label and sends the
 * relation, so "Editor" and "writer" can never drift apart.
 *
 * Owner is never assigned here: ownership moves only through
 * `transferOwnershipAction` (hosted#190).
 */

/** A tenant role as the daemon reports and accepts it. */
type TenantRoleValue = "owner" | "admin" | "writer" | "member";

/** The roles an Admin or Owner may assign or invite with. Highest first. */
export const ASSIGNABLE_TENANT_ROLES = ["admin", "writer", "member"] as const;

export type AssignableTenantRole = (typeof ASSIGNABLE_TENANT_ROLES)[number];

const TENANT_ROLE_LABEL: Readonly<Record<TenantRoleValue, string>> = {
  owner: "Owner",
  admin: "Admin",
  writer: "Editor",
  member: "Viewer",
};

/** One line per role, for the role pickers. */
export const TENANT_ROLE_HINT: Readonly<Record<AssignableTenantRole, string>> = {
  admin: "Manages users, roles and settings, and everything an Editor can do.",
  writer: "Creates and runs missions, edits targets and connectors.",
  member: "Reads missions, findings and reports. Cannot change anything.",
};

/** The label people see for a daemon role value. Unknown values show as-is. */
export function tenantRoleLabel(role: string | undefined | null): string {
  if (!role) return TENANT_ROLE_LABEL.member;
  return (TENANT_ROLE_LABEL as Record<string, string>)[role] ?? role;
}

export function isAssignableTenantRole(role: string): role is AssignableTenantRole {
  return (ASSIGNABLE_TENANT_ROLES as readonly string[]).includes(role);
}
