import { generateMeta } from "@/lib/utils";
import {
  Empty,
  EmptyContent,
  EmptyMedia,
  EmptyHeader,
  EmptyDescription,
  EmptyTitle
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { WifiOffIcon } from "lucide-react";

export async function generateMetadata() {
  return generateMeta({
    title: "Empty State 04",
    additionalTitle: true,
    description:
      "Empty states show placeholder content when no data is available. Built with shadcn/ui, Tailwind CSS, Next.js and React.",
    canonical: "/pages/empty-states/04"
  });
}

export default function Page() {
  return (
    <Empty className="h-(--content-full-height)">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WifiOffIcon />
        </EmptyMedia>
        <EmptyTitle className="text-xl">No Internet Connection</EmptyTitle>
        <EmptyDescription>
          It seems you are offline. Check your internet connection and try again.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button size="sm">Try Again</Button>
      </EmptyContent>
    </Empty>
  );
}
