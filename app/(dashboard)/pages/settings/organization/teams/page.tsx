import { TeamsContent } from "@/components/gibson/organization/TeamsContent";

export default function TeamsPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Teams</h1>
      <p className="text-sm text-muted-foreground">
        Groups within your tenant. Use per-team denies in Security Policy to
        restrict access to specific plugins, tools, or agents.
      </p>
      <TeamsContent />
    </div>
  );
}
