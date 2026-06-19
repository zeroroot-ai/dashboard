import { Suspense } from "react";
import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainView } from "@/components/gibson/brain/BrainView";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Brain",
    additionalTitle: true,
    description:
      "The live ECS brain: missions, discovered targets, findings, and a replayable Scroller of everything the mission did.",
    canonical: "/brain",
  });
}

export default function BrainPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <BrainView />
    </Suspense>
  );
}
