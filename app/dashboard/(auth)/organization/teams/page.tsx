import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { UsersIcon } from "lucide-react";
import { TeamsContent } from "@/components/gibson/organization/TeamsContent";

export default function TeamsPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Teams</h1>
        <p className="text-sm text-muted-foreground">
          Groups within your tenant for organising members and scoping access.
        </p>
      </div>

      <Card className="border-highlight/30 bg-card/40">
        <CardContent className="flex gap-3 py-4 text-sm">
          <UsersIcon
            className="size-5 shrink-0 text-highlight"
            aria-hidden="true"
          />
          <div className="space-y-2 text-muted-foreground">
            <p className="font-medium text-foreground">What teams are for</p>
            <p>
              A team is a named group of users inside your tenant. Membership
              alone grants nothing, teams become useful when you write
              per-team denies in{" "}
              <Link
                href="/dashboard/organization/security-policy"
                className="text-link hover:underline"
              >
                Security policy
              </Link>{" "}
              to restrict access to specific plugins, tools, or agents. A
              user can belong to multiple teams, and deny-wins composes
              across all of them.
            </p>
            <p>
              Deleting a team also removes every member, admin, and per-team
              deny tuple referencing it. Members keep their tenant access -
              only the team binding goes away.
            </p>
          </div>
        </CardContent>
      </Card>

      <TeamsContent />
    </div>
  );
}
