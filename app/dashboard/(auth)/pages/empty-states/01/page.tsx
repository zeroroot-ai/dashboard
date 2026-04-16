import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import { generateMeta } from "@/lib/utils";
import { FolderCodeIcon } from "lucide-react";

export async function generateMetadata() {
  return generateMeta({
    title: "Empty State 01",
    additionalTitle: true,
    description:
      "Empty states show placeholder content when no data is available. Built with shadcn/ui, Tailwind CSS, Next.js and React.",
    canonical: "/pages/empty-states/01"
  });
}

export default function Page() {
  return (
    <Empty className="h-(--content-full-height)">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderCodeIcon />
        </EmptyMedia>
        <EmptyTitle className="text-xl">No Projects Yet</EmptyTitle>
        <EmptyDescription>
          You haven&apos;t created any projects yet. Get started by creating your first project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button size="sm">Create Project</Button>
        <Button size="sm" variant="outline">
          Import Project
        </Button>
      </EmptyContent>
    </Empty>
  );
}
