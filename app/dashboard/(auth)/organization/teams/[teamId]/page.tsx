import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  return (
    <div className="p-6 space-y-6">
      <Link
        href="/dashboard/organization/teams"
        className="inline-flex items-center gap-2 text-sm text-link hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Back to teams
      </Link>
      <h1 className="text-2xl font-bold">Team: {teamId}</h1>
      <p className="text-sm text-muted-foreground">
        Team detail (roster, add/remove member, rename, delete) lands with the
        daemon ListTeamMembers RPC. Tracked in issue #148.
      </p>
    </div>
  );
}
