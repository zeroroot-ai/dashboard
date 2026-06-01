import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersIcon } from "lucide-react";

import { generateMeta } from "@/lib/utils";
import { auth } from "@/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MembersTable } from "@/components/gibson/settings/MembersTable";
import { listMembersAction } from "@/app/actions/read/listMembers";

/**
 * /dashboard/pages/settings/members — admin-gated server component.
 *
 * Renders the current tenant's member list via TenantAdminService.ListMembers.
 * Degrades to an empty state when the backend is not yet deployed (graceful
 * Unimplemented fallback in listMembersAction).
 *
 * No invite/remove actions in v1 — deferred per dashboard#340.
 *
 * Spec: dashboard#340 Module E.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Members",
    additionalTitle: true,
    description: "People with access to this workspace.",
    canonical: "/pages/settings/members",
  });
}

export default async function MembersSettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const result = await listMembersAction();
  const members = result.ok ? result.data : [];
  const loadError = result.ok ? null : result.error;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <UsersIcon
          className="mt-0.5 size-5 text-muted-foreground shrink-0"
          aria-hidden="true"
        />
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold leading-none tracking-tight">
            Members
          </h3>
          <p className="text-sm text-muted-foreground">
            People with access to this workspace. Invite and remove actions are
            coming soon.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Workspace members</CardTitle>
          <CardDescription className="text-xs">
            {members.length > 0
              ? `${members.length} member${members.length === 1 ? "" : "s"}`
              : "Member list will appear here once the workspace has members."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-medium">Failed to load members</p>
              <p className="mt-1 text-xs opacity-80">{loadError}</p>
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members found.</p>
          ) : (
            <MembersTable
              members={members}
              currentUser={{
                id: session.user.id ?? "",
                name: session.user.name ?? "",
                email: session.user.email ?? "",
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
